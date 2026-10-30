using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Ais.TicketReview;
using Newtonsoft.Json.Linq;

internal static class InventoryTests
{
    private static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    private static object Call(string method, params object[] args) { try { return typeof(ReviewApi).GetMethod(method, BindingFlags.Static | BindingFlags.NonPublic).Invoke(null, args); } catch (TargetInvocationException e) { throw e.InnerException; } }
    private static JObject State() {
        var state = new JObject();
        foreach (var key in new[] { "teams", "seasons", "games", "seats", "contacts", "requests", "allocations" }) state[key] = new JArray();
        Call("AddInventory", state, new JObject { ["title"] = "Example event", ["kind"] = "event", ["gameDate"] = "2026-12-01T02:00:00Z", ["tickets"] = 4 });
        return state;
    }
    private static JObject Edit(JObject state, int tickets = 4) => new JObject { ["gameId"] = state["games"][0]["id"], ["title"] = "Edited event", ["kind"] = "event", ["gameDate"] = "2026-12-02T02:00:00Z", ["tickets"] = tickets, ["status"] = "scheduled" };
    private static void Denied(Action run, string message) { try { run(); } catch (Microsoft.Xrm.Sdk.InvalidPluginExecutionException e) { Assert(e.Message.Contains(message), e.Message); return; } throw new Exception("Expected rejection: " + message); }
    public static int Run() {
        var tests = new Dictionary<string, Action> {
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
            ["events with even cancelled requests cannot be removed"] = () => {
                var state = State(); ((JArray)state["requests"]).Add(new JObject { ["gameId"] = state["games"][0]["id"], ["status"] = "cancelled" });
                Denied(() => Call("RemoveInventory", state, (string)state["games"][0]["id"]), "requests or allocations");
            },
            ["event history prevents changing the inventory type or season"] = () => {
                var state = State(); ((JArray)state["requests"]).Add(new JObject { ["gameId"] = state["games"][0]["id"] });
                var season = Guid.NewGuid(); ((JArray)state["seasons"]).Add(new JObject { ["id"] = season.ToString() });
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
