using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace Ais.TicketReview
{
    public sealed partial class ReviewApi
    {
        private static void ImportPriorAllocations(JObject state, JObject command, List<string> gameIds, JObject actor, DateTimeOffset now)
        {
            var rows = command["importedAllocations"] as JArray ?? new JArray();
            Check(rows.Count <= 1000, "Import at most 1000 prior ticket allocations at once.");
            Check(rows.All(row => row is JObject), "Review every imported allocation entry.");
            var seen = new HashSet<string>(); var prepared = new List<JObject>();
            foreach (var row in rows.OfType<JObject>()) {
                var index = Number(row, "rowIndex", 0, Math.Max(0, gameIds.Count - 1));
                Check(index < gameIds.Count, "Choose an imported game for the prior allocation.");
                var game = Find(state, "games", gameIds[index]); var number = Number(row, "ticketNumber", 1, (int)game["totalTickets"]);
                Check(seen.Add(gameIds[index] + ":" + number), "Each imported ticket can have only one recipient.");
                var status = Str(row, "status"); Check(status == "allocated" || status == "transferred", "Confirm the imported ticket status.");
                Check((row["crmContact"] is JObject) != !String.IsNullOrEmpty(Str(row, "contactId")), "Select one real recipient for each allocated ticket.");
                JObject contact;
                if (row["crmContact"] is JObject crm) contact = InterestCrmContacts(state, new JObject { ["purpose"] = "customer", ["quantity"] = 1, ["contactIds"] = new JArray(), ["crmContacts"] = new JArray(crm.DeepClone()) }).Single();
                else contact = Find(state, "contacts", Str(row, "contactId"));
                Check(Eligible(contact), "Select an active recipient for imported allocations.");
                var note = Text(row, "sourceNote", 1000); var file = Text(row, "sourceFile", 160); var location = Text(row, "sourceLocation", 200);
                var seat = Rows(state, "seats").Single(s => Str(s, "gameId") == gameIds[index] && Str(s, "label") == "Ticket " + number);
                Check(Str(seat, "status") == "available", "An imported ticket is already allocated.");
                prepared.Add(new JObject { ["gameId"] = gameIds[index], ["contactId"] = contact["id"], ["purpose"] = contact["type"], ["seatId"] = seat["id"],
                    ["status"] = status == "transferred" ? "transferred" : "approved", ["sourceNote"] = note, ["sourceFile"] = file, ["sourceLocation"] = location });
            }
            foreach (var group in prepared.GroupBy(r => Str(r, "gameId") + ":" + Str(r, "contactId"))) {
                var first = group.First(); var requestId = NewId();
                Add(state, "requests", new JObject { ["id"] = requestId, ["gameId"] = first["gameId"], ["requesterId"] = Guid.Empty.ToString(), ["requesterName"] = "Imported allocation", ["requesterEmail"] = "", ["recordedBy"] = actor["id"],
                    ["source"] = "file_import", ["purpose"] = first["purpose"], ["contactIds"] = new JArray(first["contactId"]), ["quantity"] = group.Count(),
                    ["rationale"] = "Prior allocation imported from " + Str(first, "sourceFile") + ". Original requester not identified.", ["opportunity"] = "", ["status"] = "fulfilled", ["createdAt"] = now.ToString("o") });
                foreach (var entry in group) {
                    var transferred = Str(entry, "status") == "transferred";
                    Find(state, "seats", Str(entry, "seatId"))["status"] = transferred ? "transferred" : "assigned";
                    Add(state, "allocations", new JObject { ["id"] = NewId(), ["requestId"] = requestId, ["gameId"] = entry["gameId"], ["seatId"] = entry["seatId"], ["contactId"] = entry["contactId"],
                        ["status"] = entry["status"], ["decision"] = "Imported prior allocation: " + Str(entry, "sourceFile") + " / " + Str(entry, "sourceLocation"), ["decidedBy"] = actor["id"],
                        ["transferReference"] = transferred ? "Recorded as transferred in source: " + Str(entry, "sourceLocation") : "", ["outcome"] = "unknown", ["evidence"] = "",
                        ["importedAt"] = now.ToString("o"), ["sourceFile"] = entry["sourceFile"], ["sourceLocation"] = entry["sourceLocation"], ["sourceNote"] = entry["sourceNote"] });
                }
            }
        }
    }
}
