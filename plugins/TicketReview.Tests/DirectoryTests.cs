using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Ais.TicketReview;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Newtonsoft.Json.Linq;

internal static class DirectoryTests
{
    private static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    private static JObject Call(string method, params object[] args)
    {
        try { return (JObject)typeof(ReviewApi).GetMethod(method, BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, args); }
        catch (TargetInvocationException ex) { throw ex.InnerException; }
    }
    private static Entity User(Guid? id = null, string name = "Example Employee") => new Entity("aaduser", id ?? Guid.NewGuid()) {
        ["displayname"] = name, ["mail"] = "employee@example.invalid", ["userprincipalname"] = "login@example.invalid",
        ["accountenabled"] = true, ["usertype"] = "Member", ["mobilephone"] = "555-0100", ["companyname"] = "Example Company"
    };
    private static JObject Contact(Guid directoryId) => new JObject {
        ["id"] = Guid.NewGuid().ToString(), ["directoryId"] = directoryId.ToString().ToUpperInvariant(), ["name"] = "Old name",
        ["type"] = "employee", ["appActive"] = false, ["directoryActive"] = true, ["tier"] = "silver", ["company"] = "AIS"
    };
    private static JObject State(params JObject[] contacts) => new JObject {
        ["contacts"] = new JArray(contacts), ["allocations"] = new JArray(new JObject { ["contactId"] = contacts.FirstOrDefault()?["id"] }),
        ["attendanceHistory"] = new JArray(new JObject { ["evidence"] = "Retain this history" })
    };
    private static void RejectUnchanged(Fake service, JObject state, string expected)
    {
        var before = state.ToString();
        try { Call("SyncDirectory", service, state); throw new Exception("Expected directory rejection"); }
        catch (InvalidPluginExecutionException ex) { Assert(ex.Message.Contains(expected), ex.Message); }
        Assert(state.ToString() == before, "A failed sync modified contacts or history");
    }
    public static int Run()
    {
        var tests = new Dictionary<string, Action> {
            ["Entra identities preserve contact IDs, inactive overrides, categories and history"] = () => {
                var user = User(); var contact = Contact(user.Id); var state = State(contact);
                var beforeHistory = state["allocations"].ToString() + state["attendanceHistory"].ToString();
                var id = (string)state["contacts"][0]["id"];
                var result = Call("SyncDirectory", new Fake(user), state);
                var saved = state["contacts"][0];
                Assert((string)saved["id"] == id && !(bool)saved["appActive"] && (string)saved["tier"] == "silver", "Existing identity/override/category changed");
                Assert((string)saved["name"] == "Example Employee" && (string)saved["email"] == "employee@example.invalid" && (bool)saved["directoryActive"], "Source profile not refreshed");
                Assert(beforeHistory == state["allocations"].ToString() + state["attendanceHistory"].ToString(), "History changed");
                Assert((int)result["added"] == 0 && (int)result["matchedExisting"] == 1, "Identity was duplicated");
            },
            ["new Entra members need no Dataverse user and matching names stay separate"] = () => {
                var state = State(); var service = new Fake(User(), User());
                var result = Call("SyncDirectory", service, state);
                Assert((int)result["added"] == 2 && ((JArray)state["contacts"]).Count == 2, "Same-named people merged");
                Assert(state["contacts"].Select(c => (string)c["directoryId"]).Distinct().Count() == 2, "Directory identity lost");
                Assert(service.Queries == 1 && service.Writes == 0, "Directory sync provisioned users or roles");
            },
            ["sync reads all Entra pages before applying contact changes"] = () => {
                var first = User(); var second = User(); var state = State();
                var service = new Fake(first) { SecondPage = new[] { second } };
                Call("SyncDirectory", service, state);
                Assert(service.Queries == 2 && ((JArray)state["contacts"]).Count == 2, "Only the first directory page was imported");
            },
            ["missing or disabled members retain their records and history"] = () => {
                var user = User(); var missing = Contact(Guid.NewGuid()); missing["appActive"] = true;
                var customer = new JObject { ["id"] = Guid.NewGuid().ToString(), ["type"] = "customer", ["name"] = "Customer", ["appActive"] = true, ["directoryActive"] = true };
                var state = State(missing, customer); var originalCustomer = state["contacts"][1].ToString();
                var result = Call("SyncDirectory", new Fake(user), state);
                Assert(!(bool)state["contacts"][0]["directoryActive"] && (bool)state["contacts"][0]["appActive"], "Missing member removed or override changed");
                Assert((int)result["markedInactive"] == 1 && state["contacts"][1].ToString() == originalCustomer, "Customer or inactivation count changed");
                Assert(((JArray)state["contacts"]).Count == 3, "Historical employee record deleted");
            },
            ["guest and disabled profiles cannot become employee options"] = () => {
                var guest = User(); guest["usertype"] = "Guest"; var disabled = User(); disabled["accountenabled"] = false;
                var state = State(); Call("SyncDirectory", new Fake(User(), guest, disabled), state);
                Assert(((JArray)state["contacts"]).Count == 1, "Guest or disabled account imported");
            },
            ["mail and mobile fall back to UPN and business phone"] = () => {
                var user = User(); user["mail"] = " "; user["mobilephone"] = ""; user["businessphones"] = "555-0200";
                var state = State(); Call("SyncDirectory", new Fake(user), state);
                Assert((string)state["contacts"][0]["email"] == "login@example.invalid" && (string)state["contacts"][0]["phone"] == "555-0200", "Directory fallback failed");
            },
            ["service account markers and reviewed test aliases are excluded"] = () => {
                var service = User(); service["mail"] = "$svc.LV.Backup@ais-now.com";
                var upnOnly = User(); upnOnly["mail"] = "ordinary@example.invalid"; upnOnly["userprincipalname"] = "SVC_SYNC@ais-now.com";
                var named = User(null, "# SVC VMware");
                var test = User(); test["mail"] = "TESTAPP@ais-now.com";
                var gateway = User(); gateway["userprincipalname"] = "sgateway@ais-now.com";
                var state = State(); Call("SyncDirectory", new Fake(User(), service, upnOnly, named, test, gateway), state);
                Assert(((JArray)state["contacts"]).Count == 1, "A non-person account became a contact");
            },
            ["excluded existing contacts retain IDs and history and stay inactive across syncs"] = () => {
                var service = User(); service["mail"] = "$svc.LV.Backup@ais-now.com";
                var contact = Contact(service.Id); contact["appActive"] = true;
                var state = State(contact); var history = state["allocations"].ToString() + state["attendanceHistory"].ToString();
                Call("SyncDirectory", new Fake(User(), service), state);
                Call("SyncDirectory", new Fake(User(), service), state);
                Assert(!(bool)state["contacts"][0]["directoryActive"] && (bool)state["contacts"][0]["appActive"] && (string)state["contacts"][0]["id"] == (string)contact["id"], "Excluded contact was lost or reactivated");
                Assert(history == state["allocations"].ToString() + state["attendanceHistory"].ToString(), "Exclusion erased history");
            },
            ["hash-prefixed human names and similar human names are retained"] = () => {
                var state = State(); Call("SyncDirectory", new Fake(User(null, "# Example Employee"), User(null, "Svend Example")), state);
                Assert(((JArray)state["contacts"]).Count == 2, "Real users were classified as service accounts");
            },
            ["an empty directory cannot deactivate every employee"] = () => RejectUnchanged(new Fake(), State(Contact(Guid.NewGuid())), "no active member"),
            ["a second-page access failure leaves all contacts unchanged"] = () => RejectUnchanged(new Fake(User()) { SecondPage = new[] { User() }, FailSecondPage = true }, State(Contact(Guid.NewGuid())), "Directory access denied"),
            ["an incomplete paging response cannot inactivate contacts"] = () => RejectUnchanged(new Fake(User()) { SecondPage = new[] { User() }, MissingCookie = true }, State(Contact(Guid.NewGuid())), "incomplete directory page"),
            ["a repeated Entra identity cannot create duplicate contacts"] = () => { var user = User(); RejectUnchanged(new Fake(user, user), State(Contact(Guid.NewGuid())), "duplicate or invalid"); },
            ["missing account status fails without treating users as disabled"] = () => { var user = User(); user.Attributes.Remove("accountenabled"); RejectUnchanged(new Fake(user), State(Contact(Guid.NewGuid())), "complete account status"); },
            ["incomplete profiles leave the prior directory intact"] = () => { var user = User(); user["mail"] = ""; user["userprincipalname"] = ""; RejectUnchanged(new Fake(user), State(Contact(Guid.NewGuid())), "profile is incomplete"); },
            ["requesters cannot invoke employee synchronization"] = () => {
                var service = new Fake(User()); var state = State();
                try { Call("Apply", service, state, new JObject { ["role"] = "requester" }, new JObject { ["type"] = "syncDirectory" }, DateTimeOffset.UtcNow, service); throw new Exception("Requester synced directory"); }
                catch (InvalidPluginExecutionException ex) { Assert(ex.Message.Contains("Coordinator"), ex.Message); }
                Assert(service.Queries == 0 && service.Writes == 0, "Requester accessed the directory");
            },
            ["sync refuses a missing caller directory service"] = () => {
                var service = new Fake(User()); var state = State();
                try { Call("Apply", service, state, new JObject { ["role"] = "coordinator" }, new JObject { ["type"] = "syncDirectory" }, DateTimeOffset.UtcNow, null); throw new Exception("Used elevated directory context"); }
                catch (InvalidPluginExecutionException ex) { Assert(ex.Message.Contains("authenticated Entra"), ex.Message); }
                Assert(service.Queries == 0, "Fell back to the elevated service");
            }
        };
        foreach (var test in tests) { test.Value(); Console.WriteLine("PASS " + test.Key); }
        return tests.Count;
    }
    private sealed class Fake : IOrganizationService
    {
        private readonly Entity[] firstPage;
        public Entity[] SecondPage;
        public bool FailSecondPage, MissingCookie;
        public int Queries, Writes;
        public Fake(params Entity[] users) { firstPage = users; }
        public EntityCollection RetrieveMultiple(QueryBase request)
        {
            Queries++;
            var query = (QueryExpression)request;
            Assert(query.EntityName == "aaduser", "Employee sync queried provisioned Dataverse users");
            Assert(!query.ColumnSet.AllColumns && query.ColumnSet.Columns.Count == 9, "Directory read included unnecessary fields");
            Assert(query.Criteria.Conditions.Any(c => c.AttributeName == "accountenabled" && c.Values.Contains(true))
                && query.Criteria.Conditions.Any(c => c.AttributeName == "usertype" && c.Values.Contains("Member")), "Missing source eligibility filters");
            if (query.PageInfo.PageNumber == 2) {
                Assert(query.PageInfo.PagingCookie == "directory-page-2", "Directory paging cookie was lost");
                if (FailSecondPage) throw new InvalidPluginExecutionException("Directory access denied");
                return new EntityCollection(SecondPage.ToList());
            }
            return new EntityCollection(firstPage.ToList()) { MoreRecords = SecondPage != null, PagingCookie = MissingCookie ? null : "directory-page-2" };
        }
        private void NoWrite() { Writes++; throw new Exception("Directory sync must not provision accounts or change roles"); }
        public Guid Create(Entity entity) { NoWrite(); return Guid.Empty; }
        public void Update(Entity entity) => NoWrite();
        public void Delete(string name, Guid id) => NoWrite();
        public void Associate(string name, Guid id, Relationship relationship, EntityReferenceCollection related) => NoWrite();
        public void Disassociate(string name, Guid id, Relationship relationship, EntityReferenceCollection related) => NoWrite();
        public Entity Retrieve(string name, Guid id, ColumnSet columns) => throw new NotSupportedException();
        public OrganizationResponse Execute(OrganizationRequest request) => throw new NotSupportedException();
    }
}
