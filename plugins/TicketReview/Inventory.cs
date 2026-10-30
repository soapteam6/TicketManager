using System;
using System.Linq;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Ais.TicketReview
{
    public sealed partial class ReviewApi
    {
        private static string InventoryStatus(JObject game, DateTimeOffset now)
        {
            return Str(game, "status") == "scheduled" && Instant(Str(game, "gameDate")) <= now ? "completed" : Str(game, "status");
        }

        private static void RequireOpenInterest(JObject game, DateTimeOffset now)
        {
            Check(Instant(Str(game, "gameDate")) > now, "This event's scheduled time has passed. New interest is closed.");
            Check((bool?)game["removed"] != true && InventoryStatus(game, now) == "scheduled", "This event is no longer accepting interest.");
        }

        private static void EditInventory(JObject state, JObject command, DateTimeOffset now)
        {
            var game = Find(state, "games", Str(command, "gameId"));
            Check((bool?)game["removed"] != true, "This event has been removed.");
            var title = Text(command, "title", 200); var date = Instant(Str(command, "gameDate"));
            var count = Number(command, "tickets", 0, 1000); var kind = Str(command, "kind"); var status = Str(command, "status");
            Check(kind == "game" || kind == "event", "Choose game or event.");
            Check(new[] { "scheduled", "completed", "cancelled" }.Contains(status), "Choose an event status.");
            Check(status != "completed" || date <= now, "A future event cannot be completed.");
            var seasonId = kind == "game" ? Str(command, "seasonId") : "";
            if (kind == "game") FindLive(state, "seasons", seasonId);
            var gameId = Str(game, "id");
            var allocations = Rows(state, "allocations").Where(a => Str(a, "gameId") == gameId).ToList();
            var hasHistory = allocations.Any() || Rows(state, "requests").Any(r => Str(r, "gameId") == gameId);
            Check(!hasHistory || Str(game, "kind") == kind && Str(game, "seasonId") == seasonId, "An event with request or allocation history cannot change type or season.");
            Check(status != "cancelled" || !allocations.Any(Active), "Cancel active allocations before cancelling this event.");
            Check(!allocations.Any(a => Str(a, "outcome") != "unknown") || AttendanceIsOpen(date, now), "An event with confirmed attendance cannot move beyond today in Pacific Time.");
            Check(!Rows(state, "games").Any(g => Str(g, "id") != gameId && (bool?)g["removed"] != true && Str(g, "title") == title && Instant(Str(g, "gameDate")) == date), "Duplicate dated inventory.");
            var seats = Rows(state, "seats").Where(seat => Str(seat, "gameId") == gameId).ToList();
            var protectedSeats = new HashSet<string>(allocations.Select(a => Str(a, "seatId")));
            var removable = seats.Where(seat => Str(seat, "status") == "available" && !protectedSeats.Contains(Str(seat, "id"))).ToList();
            Check(seats.Count - count <= removable.Count, "Ticket quantity cannot be reduced below tickets with allocation history.");
            var label = seats.Select(seat => Int32.TryParse(Regex.Match(Str(seat, "label"), @"\d+$").Value, out var n) ? n : 0).DefaultIfEmpty(0).Max();
            for (var i = seats.Count; i < count; i++) Add(state, "seats", new JObject { ["id"] = NewId(), ["gameId"] = gameId, ["label"] = "Ticket " + (++label), ["status"] = "available" });
            foreach (var seat in removable.Take(Math.Max(0, seats.Count - count))) seat.Remove();
            game["title"] = title; game["gameDate"] = date.ToString("o"); game["kind"] = kind;
            game["seasonId"] = kind == "game" ? (JToken)seasonId : JValue.CreateNull(); game["totalTickets"] = count; game["status"] = status;
            if (status != "scheduled") { game["release"] = "private"; game["releaseAt"] = JValue.CreateNull(); }
        }
        private static void RemoveInventory(JObject state, string gameId)
        {
            var game = Find(state, "games", gameId);
            Check((bool?)game["removed"] != true, "This event has been removed.");
            Check(!Rows(state, "requests").Any(r => Str(r, "gameId") == gameId) && !Rows(state, "allocations").Any(a => Str(a, "gameId") == gameId), "Events with requests or allocations cannot be removed.");
            game["removed"] = true; game["status"] = "cancelled"; game["release"] = "private"; game["releaseAt"] = JValue.CreateNull();
        }

        private static JObject FindLive(JObject state, string collection, string id)
        {
            var row = Find(state, collection, id);
            Check((bool?)row["removed"] != true, "This " + (collection == "teams" ? "team" : "season") + " has been deleted.");
            if (collection == "seasons") Check((bool?)Find(state, "teams", Str(row, "teamId"))["removed"] != true, "The team has been deleted.");
            return row;
        }

        private static void RemoveInventoryGroup(JObject state, string collection, string id)
        {
            var target = FindLive(state, collection, id);
            var seasons = collection == "teams" ? Rows(state, "seasons").Where(s => Str(s, "teamId") == id).ToList() : new List<JObject> { target };
            var seasonIds = new HashSet<string>(seasons.Select(s => Str(s, "id")));
            var games = Rows(state, "games").Where(g => seasonIds.Contains(Str(g, "seasonId"))).ToList();
            var ids = new HashSet<string>(games.Select(g => Str(g, "id")));
            Check(!Rows(state, "requests").Any(r => ids.Contains(Str(r, "gameId"))) && !Rows(state, "allocations").Any(a => ids.Contains(Str(a, "gameId"))),
                "Cannot delete: an affected game has request or allocation history.");
            // Keep native rows and foreign keys intact; the entire hierarchy is
            // hidden in one transaction only after every descendant is checked.
            foreach (var game in games) { game["removed"] = true; game["status"] = "cancelled"; game["release"] = "private"; game["releaseAt"] = JValue.CreateNull(); }
            foreach (var season in seasons) season["removed"] = true;
            if (collection == "teams") target["removed"] = true;
        }
    }
}
