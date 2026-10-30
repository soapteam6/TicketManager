using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Ais.TicketReview;
using Newtonsoft.Json.Linq;

internal static class InventoryTests
{
    private static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    private static object Call(string method, params object[] args) { try { var target = typeof(ReviewApi).GetMethod(method, BindingFlags.Static | BindingFlags.NonPublic); return target.Invoke(null, args.Concat(target.GetParameters().Skip(args.Length).Select(p => p.DefaultValue)).ToArray()); } catch (TargetInvocationException e) { throw e.InnerException; } }
    private static JObject State() {
        var state = new JObject();
        foreach (var key in new[] { "teams", "seasons", "games", "seats", "contacts", "requests", "allocations" }) state[key] = new JArray();
        Call("AddInventory", state, new JObject { ["title"] = "Example event", ["kind"] = "event", ["gameDate"] = "2026-12-01T02:00:00Z", ["tickets"] = 4 });
        return state;
    }
    private static JObject Edit(JObject state, int tickets = 4) => new JObject { ["gameId"] = state["games"][0]["id"], ["title"] = "Edited event", ["kind"] = "event", ["gameDate"] = "2026-12-02T02:00:00Z", ["tickets"] = tickets, ["status"] = "scheduled" };
    private static JObject DeletionState() {
        var s = State(); var team = Guid.NewGuid().ToString(); var season = Guid.NewGuid().ToString();
        ((JArray)s["teams"]).Add(new JObject { ["id"] = team, ["name"] = "Deletion example" });
        ((JArray)s["seasons"]).Add(new JObject { ["id"] = season, ["teamId"] = team });
        s["games"][0]["kind"] = "game"; s["games"][0]["seasonId"] = season;
        Call("AddInventory", s, new JObject { ["title"] = "Second deletion game", ["kind"] = "game", ["seasonId"] = season, ["gameDate"] = "2027-01-01T00:00:00Z", ["tickets"] = 2 });
        return s;
    }
    private static void Denied(Action run, string message) { try { run(); } catch (Microsoft.Xrm.Sdk.InvalidPluginExecutionException e) { Assert(e.Message.Contains(message), e.Message); return; } throw new Exception("Expected rejection: " + message); }
    public static int Run() {
        var tests = new Dictionary<string, Action> {
            ["team deletion hides all unused descendants and retains native record identities"] = () => {
                var s = DeletionState(); var beforeSeats = s["seats"].ToString(); var ids = ((JArray)s["games"]).Select(g => (string)g["id"]).ToList();
                Call("RemoveInventoryGroup", s, "teams", (string)s["teams"][0]["id"]);
                Assert((bool)s["teams"][0]["removed"] && (bool)s["seasons"][0]["removed"] && ((JArray)s["games"]).All(g => (bool)g["removed"] && (string)g["status"] == "cancelled"), "Incomplete hierarchy removal");
                Assert(s["seats"].ToString() == beforeSeats && ((JArray)s["games"]).Select(g => (string)g["id"]).SequenceEqual(ids), "Deletion erased native identities");
                Denied(() => Call("FindLive", s, "teams", (string)s["teams"][0]["id"]), "deleted");
                Denied(() => Call("AddInventory", s, new JObject { ["title"] = "Invalid deleted target", ["kind"] = "game", ["seasonId"] = s["seasons"][0]["id"], ["gameDate"] = "2027-02-01T00:00:00Z", ["tickets"] = 1 }), "deleted");
            },
            ["season deletion retains the parent team and unrelated inventory"] = () => {
                var s = DeletionState(); Call("AddInventory", s, new JObject { ["title"] = "Independent event", ["kind"] = "event", ["gameDate"] = "2027-03-01T00:00:00Z", ["tickets"] = 1 });
                Call("RemoveInventoryGroup", s, "seasons", (string)s["seasons"][0]["id"]);
                Assert((bool?)s["teams"][0]["removed"] != true && (bool)s["seasons"][0]["removed"] && (bool?)s["games"][2]["removed"] != true, "Unrelated inventory removed");
            },
            ["active allocations on any descendant require explicit cancellation before anything changes"] = () => {
                foreach (var collection in new[] { "teams", "seasons" }) {
                    var s = DeletionState(); ((JArray)s["allocations"]).Add(new JObject { ["id"] = Guid.NewGuid().ToString(), ["gameId"] = s["games"][1]["id"], ["status"] = "approved" });
                    var before = s.ToString(); Denied(() => Call("RemoveInventoryGroup", s, collection, (string)s[collection][0]["id"]), "Confirm cancellation");
                    Assert(s.ToString() == before, "Rejected deletion partially altered the hierarchy");
                }
            },
            ["confirmed deletion cancels active allocations and requests while preserving transfer and attendance history"] = () => {
                var s = DeletionState(); var contact = Guid.NewGuid().ToString(); ((JArray)s["contacts"]).Add(new JObject { ["id"] = contact }); s["attendanceHistory"] = new JArray(new JObject { ["evidence"] = "Original confirmation" });
                for (var i = 0; i < 2; i++) {
                    var request = Guid.NewGuid().ToString(); var seat = s["seats"][i == 0 ? 0 : 4]; seat["status"] = i == 0 ? "assigned" : "transferred";
                    ((JArray)s["requests"]).Add(new JObject { ["id"] = request, ["gameId"] = s["games"][i]["id"], ["status"] = "fulfilled", ["quantity"] = 1, ["contactIds"] = new JArray(contact) });
                    ((JArray)s["allocations"]).Add(new JObject { ["id"] = Guid.NewGuid().ToString(), ["requestId"] = request, ["gameId"] = s["games"][i]["id"], ["seatId"] = seat["id"], ["contactId"] = contact, ["status"] = i == 0 ? "approved" : "transferred", ["outcome"] = "attended", ["evidence"] = "Original confirmation", ["transferReference"] = "Original provider reference" });
                }
                var history = s["attendanceHistory"].ToString(); var actor = new JObject { ["id"] = Guid.NewGuid().ToString() }; var now = DateTimeOffset.Parse("2030-01-01T00:00:00Z");
                Call("RemoveInventoryGroup", s, "teams", (string)s["teams"][0]["id"], new JObject { ["cancelAllocations"] = true }, actor, now); Call("Validate", s, now);
                Assert(((JArray)s["allocations"]).All(a => (string)a["status"] == "cancelled" && (string)a["cancelledBy"] == (string)actor["id"] && (string)a["outcome"] == "attended" && (string)a["transferReference"] == "Original provider reference"), "Allocation provenance or history lost");
                Assert((string)s["allocations"][1]["statusBeforeDeletion"] == "transferred" && ((JArray)s["requests"]).All(r => (string)r["status"] == "cancelled") && s["attendanceHistory"].ToString() == history, "Historical state lost");
                Assert(((JArray)s["seats"]).All(row => (string)row["status"] == "available"), "Cancelled allocations left seats assigned");
            },
            ["requesters cannot delete teams or seasons by calling the API directly"] = () => {
                foreach (var type in new[] { "removeTeam", "removeSeason" }) {
                    var s = DeletionState(); var before = s.ToString();
                    Denied(() => Call("Apply", null, s, new JObject { ["role"] = "requester" }, new JObject { ["type"] = type }, DateTimeOffset.UtcNow, null), "Coordinator");
                    Assert(s.ToString() == before, "Unauthorized deletion changed data");
                }
            },
            ["attendance opens at Pacific midnight in summer winter and daylight saving transitions"] = () => {
                foreach (var pair in new[] {
                    new[] { "2026-07-16T02:00:00Z", "2026-07-15T07:00:00Z" },
                    new[] { "2026-12-16T03:00:00Z", "2026-12-15T08:00:00Z" },
                    new[] { "2026-03-09T02:00:00Z", "2026-03-08T08:00:00Z" },
                    new[] { "2026-11-02T03:00:00Z", "2026-11-01T07:00:00Z" }
                }) {
                    var game = DateTimeOffset.Parse(pair[0]); var midnight = DateTimeOffset.Parse(pair[1]);
                    Assert(!(bool)Call("AttendanceIsOpen", game, midnight.AddTicks(-1)), "Attendance opened before the event day");
                    Assert((bool)Call("AttendanceIsOpen", game, midnight), "Attendance did not open at midnight");
                }
            },
            ["same-day attendance before start survives full state validation and later edits"] = () => {
                var s = State(); var game = (JObject)s["games"][0]; game["gameDate"] = "2026-12-02T02:00:00Z";
                var now = DateTimeOffset.Parse("2026-12-01T08:00:00Z"); s["attendanceHistory"] = new JArray();
                var contact = Guid.NewGuid().ToString(); var request = Guid.NewGuid().ToString(); var allocation = Guid.NewGuid().ToString();
                ((JArray)s["contacts"]).Add(new JObject { ["id"] = contact });
                ((JArray)s["requests"]).Add(new JObject { ["id"] = request, ["gameId"] = game["id"], ["contactIds"] = new JArray(contact), ["quantity"] = 1 });
                s["seats"][0]["status"] = "assigned";
                ((JArray)s["allocations"]).Add(new JObject { ["id"] = allocation, ["requestId"] = request, ["contactId"] = contact, ["gameId"] = game["id"], ["seatId"] = s["seats"][0]["id"], ["status"] = "approved", ["outcome"] = "unknown", ["evidence"] = "" });
                var actor = new JObject { ["id"] = Guid.NewGuid().ToString(), ["role"] = "coordinator" };
                var command = new JObject { ["type"] = "attendance", ["assignmentId"] = allocation, ["outcome"] = "attended", ["evidence"] = "Confirmed with recipient" };
                Denied(() => Call("Apply", null, s, actor, command, now.AddSeconds(-1), null), "event day");
                Call("Apply", null, s, actor, command, now, null); Call("Validate", s, now);
                var edit = Edit(s); edit["gameDate"] = "2026-12-02T03:00:00Z"; Call("EditInventory", s, edit, now); Call("Validate", s, now);
                edit["gameDate"] = "2026-12-03T03:00:00Z"; Denied(() => Call("EditInventory", s, edit, now), "beyond today");
                Assert(((JArray)s["attendanceHistory"]).Count == 1, "Attendance audit missing");
            },
            ["past scheduled events complete at their exact instant and cancellations are preserved"] = () => {
                var now = DateTimeOffset.Parse("2026-10-30T15:00:00Z"); var game = new JObject { ["status"] = "scheduled", ["gameDate"] = "2026-10-30T08:00:00-07:00" };
                Assert((string)Call("InventoryStatus", game, now.AddTicks(-1)) == "scheduled", "Future event completed early");
                Assert((string)Call("InventoryStatus", game, now) == "completed", "Past event still scheduled");
                Denied(() => Call("RequireOpenInterest", game, now), "scheduled time has passed");
                Assert((string)game["status"] == "scheduled", "Read rewrote stored status");
                game["status"] = "cancelled"; Assert((string)Call("InventoryStatus", game, now) == "cancelled", "Cancellation overwritten");
            },
            ["future scheduled events accept interest while completed cancelled and removed events do not"] = () => {
                var now = DateTimeOffset.Parse("2026-10-30T15:00:00Z"); var game = new JObject { ["status"] = "scheduled", ["gameDate"] = "2026-10-30T15:00:01Z" };
                Call("RequireOpenInterest", game, now);
                foreach (var status in new[] { "completed", "cancelled" }) { game["status"] = status; Denied(() => Call("RequireOpenInterest", game, now), "no longer accepting"); }
                game["status"] = "scheduled"; game["removed"] = true; Denied(() => Call("RequireOpenInterest", game, now), "no longer accepting");
            },
            ["event edits preserve identity and grow/shrink unused ticket capacity"] = () => {
                var state = State(); var id = (string)state["games"][0]["id"];
                Call("EditInventory", state, Edit(state, 6), DateTimeOffset.UtcNow);
                Assert(((JArray)state["seats"]).Count == 6 && (string)state["games"][0]["id"] == id, "Capacity growth changed identity");
                Call("EditInventory", state, Edit(state, 2), DateTimeOffset.UtcNow);
                Assert(((JArray)state["seats"]).Count == 2 && (int)state["games"][0]["totalTickets"] == 2, "Capacity shrink mismatch");
            },
            ["tickets with cancelled allocation history cannot be removed by a capacity edit"] = () => {
                var state = State(); ((JArray)state["allocations"]).Add(new JObject { ["gameId"] = state["games"][0]["id"], ["seatId"] = state["seats"][0]["id"], ["status"] = "cancelled", ["outcome"] = "unknown" });
                var before = state.ToString(); Denied(() => Call("EditInventory", state, Edit(state, 0), DateTimeOffset.UtcNow), "allocation history"); Assert(state.ToString() == before, "Rejected edit altered history");
            },
            ["removal retains the unused event and ticket records"] = () => {
                var state = State(); Call("RemoveInventory", state, (string)state["games"][0]["id"]);
                Assert((bool)state["games"][0]["removed"] && (string)state["games"][0]["status"] == "cancelled" && ((JArray)state["seats"]).Count == 4, "Removal erased native history");
            },
            ["cancelled request history no longer blocks deletion and is retained"] = () => {
                var state = State(); ((JArray)state["requests"]).Add(new JObject { ["gameId"] = state["games"][0]["id"], ["status"] = "cancelled" });
                Call("RemoveInventory", state, (string)state["games"][0]["id"]); Assert((bool)state["games"][0]["removed"] && ((JArray)state["requests"]).Count == 1, "History erased during deletion");
            },
            ["event history prevents changing the inventory type or season"] = () => {
                var state = State(); ((JArray)state["requests"]).Add(new JObject { ["gameId"] = state["games"][0]["id"] });
                var season = Guid.NewGuid(); var team = Guid.NewGuid().ToString(); ((JArray)state["teams"]).Add(new JObject { ["id"] = team }); ((JArray)state["seasons"]).Add(new JObject { ["id"] = season.ToString(), ["teamId"] = team });
                var edit = Edit(state); edit["kind"] = "game"; edit["seasonId"] = season.ToString();
                Denied(() => Call("EditInventory", state, edit, DateTimeOffset.UtcNow), "cannot change type or season");
            },
            ["cancelling an event requires cancelling its active allocations first"] = () => {
                var state = State(); ((JArray)state["allocations"]).Add(new JObject { ["gameId"] = state["games"][0]["id"], ["status"] = "approved" });
                var edit = Edit(state); edit["status"] = "cancelled";
                Denied(() => Call("EditInventory", state, edit, DateTimeOffset.UtcNow), "Cancel active allocations");
            },
            ["requesters cannot edit or remove event inventory"] = () => {
                foreach (var command in new[] { "editInventory", "removeInventory" }) Denied(() => Call("Apply", null, State(), new JObject { ["role"] = "requester" }, new JObject { ["type"] = command }, DateTimeOffset.UtcNow, null), "Coordinator");
            },
            ["native event edits clear an old season lookup for a dated event"] = () => {
                var state = State(); var native = (Microsoft.Xrm.Sdk.Entity)Call("Native", "games", state["games"][0]);
                Assert(native.Contains("cr9cd_season") && native["cr9cd_season"] == null, "Native season lookup was not cleared");
            },
            ["confirmed attendance requires a nonblank note while Unknown permits an empty note"] = () => {
                var state = State(); state["games"][0]["gameDate"] = "2026-01-01T02:00:00Z"; state["attendanceHistory"] = new JArray();
                var id = Guid.NewGuid().ToString();
                ((JArray)state["allocations"]).Add(new JObject { ["id"] = id, ["gameId"] = state["games"][0]["id"], ["status"] = "approved", ["outcome"] = "unknown", ["evidence"] = "" });
                var actor = new JObject { ["role"] = "coordinator", ["id"] = Guid.NewGuid().ToString() };
                foreach (var outcome in new[] { "attended", "no_show" }) {
                    var command = new JObject { ["type"] = "attendance", ["assignmentId"] = id, ["outcome"] = outcome, ["evidence"] = "   " };
                    Denied(() => Call("Apply", null, state, actor, command, DateTimeOffset.UtcNow, null), "evidence");
                    Assert((string)state["allocations"][0]["outcome"] == "unknown" && !state["attendanceHistory"].Any(), "Blank note changed attendance");
                }
                Call("Apply", null, state, actor, new JObject { ["type"] = "attendance", ["assignmentId"] = id, ["outcome"] = "attended", ["evidence"] = "Confirmed with attendee" }, DateTimeOffset.UtcNow, null);
                Call("Apply", null, state, actor, new JObject { ["type"] = "attendance", ["assignmentId"] = id, ["outcome"] = "unknown", ["evidence"] = "" }, DateTimeOffset.UtcNow, null);
                Assert((string)state["allocations"][0]["outcome"] == "unknown" && ((JArray)state["attendanceHistory"]).Count == 2, "Unknown or audit correction failed");
            }
        };
        foreach (var test in tests) { test.Value(); Console.WriteLine("PASS " + test.Key); }
        return tests.Count;
    }
}
