using System;
using System.Linq;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;

namespace Ais.TicketReview
{
    public sealed partial class ReviewApi
    {
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
            if (kind == "game") Find(state, "seasons", seasonId);
            var gameId = Str(game, "id");
            var allocations = Rows(state, "allocations").Where(a => Str(a, "gameId") == gameId).ToList();
            var hasHistory = allocations.Any() || Rows(state, "requests").Any(r => Str(r, "gameId") == gameId);
            Check(!hasHistory || Str(game, "kind") == kind && Str(game, "seasonId") == seasonId, "An event with request or allocation history cannot change type or season.");
            Check(status != "cancelled" || !allocations.Any(Active), "Cancel active allocations before cancelling this event.");
            Check(!allocations.Any(a => Str(a, "outcome") != "unknown") || date <= now, "An event with confirmed attendance cannot move into the future.");
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
    }
}
