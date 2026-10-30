using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Ais.TicketReview;
using Microsoft.Xrm.Sdk;
using Newtonsoft.Json.Linq;

internal static class FileAllocationTests
{
    private static object Call(string method, params object[] args) { try { return typeof(ReviewApi).GetMethod(method, BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, args); } catch (TargetInvocationException e) { throw e.InnerException; } }
    private static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    private static JObject State() {
        var state = new JObject(); foreach (var key in new[] { "teams", "seasons", "games", "seats", "contacts", "requests", "allocations", "attendanceHistory" }) state[key] = new JArray();
        ((JArray)state["contacts"]).Add(new JObject { ["id"] = "40000000-0000-4000-8000-000000000001", ["name"] = "Real selected employee", ["type"] = "employee", ["appActive"] = true, ["directoryActive"] = true });
        return state;
    }
    private static JObject Command() => new JObject {
        ["type"] = "importSchedule", ["seasonId"] = "", ["csv"] = "date,time,title,tickets,kind\n2026-01-01,03:00,Prior file event,2,event",
        ["importedAllocations"] = new JArray(new JObject { ["rowIndex"] = 0, ["ticketNumber"] = 1, ["status"] = "transferred", ["contactId"] = "40000000-0000-4000-8000-000000000001", ["sourceFile"] = "tracker.xlsx", ["sourceLocation"] = "Tickets row 3", ["sourceNote"] = "Gary; identity selected manually during review" })
    };
    public static int Run() {
        var tests = new Dictionary<string, Action> {
            ["file import preserves prior allocations before today without inventing attendance or a requester"] = () => {
                var state = State(); var actor = new JObject { ["id"] = Guid.NewGuid().ToString(), ["role"] = "coordinator" }; var now = DateTimeOffset.Parse("2026-10-30T12:00:00Z");
                Call("Apply", null, state, actor, Command(), now, null); Call("Validate", state, now);
                Assert(((JArray)state["games"]).Count == 1 && (string)state["games"][0]["release"] == "private", "Event not staged privately");
                Assert((string)state["allocations"][0]["status"] == "transferred" && (string)state["allocations"][0]["outcome"] == "unknown", "Transfer/attendance misrepresented");
                Assert((string)state["requests"][0]["requesterId"] == Guid.Empty.ToString() && (string)state["requests"][0]["recordedBy"] == (string)actor["id"], "Original requester was guessed");
                Assert(((JArray)state["seats"]).Count(seat => (string)seat["status"] == "available") == 1 && !state["attendanceHistory"].Any(), "Availability or attendance corrupted");
            },
            ["file allocations require an eligible real recipient and unique in-range ticket positions"] = () => {
                foreach (var mode in new[] { "missing-recipient", "inactive", "duplicate", "outside-capacity" }) {
                    var state = State(); var command = Command(); var row = (JObject)command["importedAllocations"][0];
                    if (mode == "missing-recipient") row.Remove("contactId");
                    if (mode == "inactive") state["contacts"][0]["directoryActive"] = false;
                    if (mode == "duplicate") ((JArray)command["importedAllocations"]).Add(row.DeepClone());
                    if (mode == "outside-capacity") row["ticketNumber"] = 3;
                    var rejected = false;
                    try { Call("Apply", null, state, new JObject { ["id"] = Guid.NewGuid().ToString(), ["role"] = "coordinator" }, command, DateTimeOffset.UtcNow, null); } catch (InvalidPluginExecutionException) { rejected = true; }
                    Assert(rejected, "Invalid allocation accepted: " + mode);
                }
            },
            ["requesters cannot import past allocations directly"] = () => {
                var state = State(); var before = state.ToString(); var rejected = false;
                try { Call("Apply", null, state, new JObject { ["role"] = "requester" }, Command(), DateTimeOffset.UtcNow, null); } catch (InvalidPluginExecutionException) { rejected = true; }
                Assert(rejected && state.ToString() == before, "Requester changed imported inventory");
            }
        };
        foreach (var test in tests) { test.Value(); Console.WriteLine("PASS " + test.Key); } return tests.Count;
    }
}
