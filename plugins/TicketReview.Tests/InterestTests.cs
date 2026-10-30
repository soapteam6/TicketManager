using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Ais.TicketReview;
using Microsoft.Xrm.Sdk;
using Newtonsoft.Json.Linq;

internal static class InterestTests
{
    private static object Call(string method, params object[] args) { try { return typeof(ReviewApi).GetMethod(method, BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, args); } catch (TargetInvocationException e) { throw e.InnerException; } }
    private static void Assert(bool ok, string message) { if (!ok) throw new Exception(message); }
    private static void Denied(Action run, string message) { try { run(); } catch (InvalidPluginExecutionException e) { Assert(e.Message.Contains(message), e.Message); return; } throw new Exception("Expected rejection: " + message); }
    private static JObject Employee() => new JObject { ["id"] = Guid.NewGuid().ToString(), ["type"] = "employee", ["directoryId"] = Guid.NewGuid().ToString(), ["name"] = "Example employee", ["email"] = "example@example.invalid", ["appActive"] = true, ["directoryActive"] = true };
    private static JObject State(params JObject[] contacts) => new JObject {
        ["contacts"] = new JArray(contacts), ["requests"] = new JArray(), ["games"] = new JArray(new JObject { ["id"] = Guid.NewGuid().ToString(), ["status"] = "scheduled", ["gameDate"] = "2030-12-01T00:00:00Z", ["release"] = "released" })
    };
    private static JObject Actor(string role = "coordinator") => new JObject { ["id"] = Guid.NewGuid().ToString(), ["directoryId"] = Guid.NewGuid().ToString(), ["role"] = role, ["key"] = role == "coordinator" ? "coordinator" : "rep" };
    private static JObject Command(JObject state, JObject employee) => new JObject { ["type"] = "interest", ["gameId"] = state["games"][0]["id"], ["quantity"] = 2, ["purpose"] = "employee", ["contactIds"] = new JArray(employee["id"]), ["onBehalfContactId"] = employee["id"], ["rationale"] = "Employee recognition" };
    private static JObject CrmPerson(string accountId = null) => new JObject { ["contactId"] = Guid.NewGuid().ToString(), ["accountId"] = accountId ?? Guid.NewGuid().ToString(), ["accountName"] = "Example business", ["name"] = "Example customer", ["email"] = "customer@example.invalid", ["phone"] = "" };
    private static JObject CrmCommand(params JObject[] people) => new JObject { ["purpose"] = "customer", ["quantity"] = 2, ["contactIds"] = new JArray(), ["crmContacts"] = new JArray(people) };
    public static int Run() {
        var tests = new Dictionary<string, Action> {
            ["employee requester does not require a Dataverse user and records the authenticated coordinator"] = () => {
                var e = Employee(); var s = State(e); var actor = Actor();
                Call("Apply", null, s, actor, Command(s, e), DateTimeOffset.Parse("2026-10-30T12:00:00Z"), null);
                var r = s["requests"][0]; Assert((string)r["requesterDirectoryId"] == (string)e["directoryId"] && (string)r["requesterContactId"] == (string)e["id"], "Entra requester missing");
                Assert((string)r["recordedBy"] == (string)actor["id"] && ((JArray)r["contactIds"]).Count == 1, "Recorder or self beneficiary incorrect");
            },
            ["requester ownership uses Entra identity and never name or email"] = () => {
                var actor = Actor("requester"); var request = new JObject { ["requesterId"] = Guid.NewGuid().ToString(), ["requesterDirectoryId"] = actor["directoryId"] };
                Assert((bool)Call("OwnInterest", request, actor), "Employee cannot see on-behalf request");
                actor["directoryId"] = Guid.NewGuid().ToString(); Assert(!(bool)Call("OwnInterest", request, actor), "Another user can see request");
                actor["directoryId"] = ""; request["requesterDirectoryId"] = ""; Assert(!(bool)Call("OwnInterest", request, actor), "Empty identity grants access");
                actor["id"] = request["requesterId"]; Assert((bool)Call("OwnInterest", request, actor), "Legacy ownership broken");
            },
            ["coordinators cannot submit other employees as self beneficiaries"] = () => {
                var e = Employee(); var other = Employee(); var s = State(e, other); var c = Command(s, e); c["contactIds"] = new JArray(e["id"], other["id"]);
                Denied(() => Call("Apply", null, s, Actor(), c, DateTimeOffset.UtcNow, null), "only the requesting person");
                Assert(!s["requests"].Any(), "Rejected self request was saved");
            },
            ["on-behalf requester selection rejects inactive customers and non-coordinators"] = () => {
                var e = Employee(); var s = State(e); var c = Command(s, e);
                Denied(() => Call("InterestRequester", null, s, Actor("requester"), c), "Only coordinators");
                e = (JObject)s["contacts"][0]; e["directoryActive"] = false;
                Denied(() => Call("InterestRequester", null, s, Actor(), c), "active employee");
                e["directoryActive"] = true; e["type"] = "customer";
                Denied(() => Call("InterestRequester", null, s, Actor(), c), "active employee");
            },
            ["CRM beneficiaries are local customers deduplicated by source organization and contact ID"] = () => {
                var s = State(); var p = CrmPerson(); var c = CrmCommand(p);
                var first = (List<JObject>)Call("InterestCrmContacts", s, c); first[0]["tier"] = "gold"; first[0]["name"] = "Coordinator reviewed";
                var second = (List<JObject>)Call("InterestCrmContacts", s, c);
                Assert(((JArray)s["contacts"]).Count == 1 && (string)first[0]["id"] == (string)second[0]["id"], "Duplicate contact created");
                Assert((string)second[0]["tier"] == "gold" && (string)second[0]["name"] == "Coordinator reviewed" && (string)second[0]["type"] == "customer", "Reviewed details overwritten");
                first[0]["appActive"] = false; Denied(() => Call("InterestCrmContacts", s, c), "inactive");
            },
            ["CRM preparation rejects mixed businesses and duplicates before adding any contacts"] = () => {
                var s = State(); var p = CrmPerson();
                Denied(() => Call("InterestCrmContacts", s, CrmCommand(p, CrmPerson())), "one business");
                Denied(() => Call("InterestCrmContacts", s, CrmCommand(p, p)), "once");
                Assert(!s["contacts"].Any(), "Invalid CRM selection created a partial contact");
                var invalid = CrmPerson(); invalid["accountId"] = "not-a-guid"; Denied(() => Call("InterestCrmContacts", s, CrmCommand(invalid)), "valid CRM");
            },
            ["employees cannot create customer contacts by bypassing the form"] = () => {
                var s = State(); var c = CrmCommand(CrmPerson()); c["type"] = "interest"; c["gameId"] = s["games"][0]["id"];
                var actor = Actor("requester"); actor["key"] = "employee";
                Denied(() => Call("Apply", null, s, actor, c, DateTimeOffset.UtcNow, null), "Employees request for self");
                Assert(!s["contacts"].Any() && !s["requests"].Any(), "Employee created customer data");
            }
        };
        foreach (var t in tests) { t.Value(); Console.WriteLine("PASS " + t.Key); } return tests.Count;
    }
}


