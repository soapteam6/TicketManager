using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Ais.TicketReview
{
    public sealed partial class ReviewApi
    {
        private const string SearchTable = "cr9cd_schedulesearch";
        private static readonly Guid SearchFlowId = new Guid("c5df18a1-df8f-4f17-bac4-e04d99d6be79");
        private static bool ScheduleSearchAvailable(IOrganizationService service)
        {
            var query = new QueryExpression("workflow") { ColumnSet = new ColumnSet("statecode") };
            query.Criteria.AddCondition("workflowid", ConditionOperator.Equal, SearchFlowId);
            return service.RetrieveMultiple(query).Entities.Any(e => e.GetAttributeValue<OptionSetValue>("statecode")?.Value == 1);
        }

        // These operations never acquire or change the ticket-workspace lock/revision.
        // The background flow can search the public web while ordinary ticket work continues.
        private static JObject ScheduleSearch(IOrganizationService service, JObject actor, JObject input)
        {
            RequireAdmin(actor);
            Check(Guid.TryParse(Str(input, "jobId"), out var id) && id != Guid.Empty, "A unique search ID is required.");
            var query = new QueryExpression(SearchTable) { ColumnSet = new ColumnSet(true) };
            query.Criteria.AddCondition(SearchTable + "id", ConditionOperator.Equal, id);
            var existing = service.RetrieveMultiple(query).Entities.SingleOrDefault();
            if (Str(input, "operation") == "scheduleSearchStart") {
                Check(ScheduleSearchAvailable(service), "Schedule search is not configured yet. Use CSV import for now.");
                var request = input["request"] as JObject;
                Check(request != null, "Enter a schedule to find.");
                var original = existing == null ? null : Parse(existing.GetAttributeValue<string>("cr9cd_input"));
                var files = ImportFileMetadata(request, original);
                var text = Str(request, "query").Trim();
                Check(text.Length <= 2000 && (text.Length > 0 || files.Count > 0), "Describe what to import or attach a file.");
                if (text.Length == 0) text = "Prepare an import from the uploaded files.";
                Check(!text.Any(ch => Char.IsControl(ch) && ch != '\r' && ch != '\n' && ch != '\t'), "Remove unsupported control characters from the request.");
                var seasonId = Guid.Empty;
                var season = new JObject();
                if (!String.IsNullOrEmpty(Str(request, "seasonId"))) {
                    Check(Guid.TryParse(Str(request, "seasonId"), out seasonId) && seasonId != Guid.Empty, "Select a valid season.");
                    var seasonEntity = service.Retrieve("cr9cd_season", seasonId, new ColumnSet("cr9cd_review_scope", "cr9cd_review_data"));
                    Check(seasonEntity.GetAttributeValue<string>("cr9cd_review_scope") == Scope, "Select a season from this workspace.");
                    season = Parse(seasonEntity.GetAttributeValue<string>("cr9cd_review_data"));
                    Check((bool?)season["removed"] != true, "This season has been deleted.");
                }
                var tickets = Number(request, "ticketsPerEvent", 0, 1000);
                Check(request["homeOnly"]?.Type == JTokenType.Boolean, "Choose home games or all games.");
                var payload = new JObject {
                    ["query"] = text, ["seasonId"] = seasonId == Guid.Empty ? "" : seasonId.ToString(), ["seasonLabel"] = season["label"],
                    ["from"] = files.Count > 0 ? null : season["startDate"], ["through"] = files.Count > 0 ? null : season["endDate"],
                    ["ticketsPerEvent"] = tickets, ["homeOnly"] = request["homeOnly"].DeepClone()
                };
                if (!String.IsNullOrEmpty(Str(request, "timeZone"))) {
                    Check(Str(request, "timeZone").Length <= 100 && System.Text.RegularExpressions.Regex.IsMatch(Str(request, "timeZone"), @"^(UTC|[A-Za-z_]+(/[A-Za-z0-9_+.\-]+)+)$"), "Choose a valid timezone.");
                    payload["timeZone"] = Str(request, "timeZone");
                }
                if (files.Count > 0) payload["files"] = files;
                if (existing == null) payload["today"] = DateTime.UtcNow.ToString("yyyy-MM-dd");
                else if (original["today"] != null) payload["today"] = original["today"];
                if (existing != null) {
                    Check(existing.GetAttributeValue<string>("cr9cd_requestedby") == Str(actor, "id"), "Search not found.");
                    Check(JToken.DeepEquals(Parse(existing.GetAttributeValue<string>("cr9cd_input")), payload), "This search ID was already used for another query.");
                } else {
                    var active = new QueryExpression(SearchTable) { ColumnSet = new ColumnSet(false), TopCount = 2 };
                    active.Criteria.AddCondition("cr9cd_requestedby", ConditionOperator.Equal, Str(actor, "id"));
                    active.Criteria.AddCondition("cr9cd_status", ConditionOperator.In, "queued", "searching");
                    active.Criteria.AddCondition("createdon", ConditionOperator.OnOrAfter, DateTime.UtcNow.AddHours(-4));
                    Check(service.RetrieveMultiple(active).Entities.Count < 2, "Wait for one of your current schedule searches to finish.");
                    existing = new Entity(SearchTable, id) {
                        ["cr9cd_name"] = text.Substring(0, Math.Min(300, text.Length)).Replace('\r', ' ').Replace('\n', ' '), ["cr9cd_requestedby"] = Str(actor, "id"),
                        ["cr9cd_status"] = "queued", ["cr9cd_input"] = payload.ToString(Formatting.None)
                    };
                    service.Create(existing);
                    SaveImportFiles(service, id, request, files);
                }
            }
            Check(existing != null && existing.GetAttributeValue<string>("cr9cd_requestedby") == Str(actor, "id"), "Search not found.");
            var status = existing.GetAttributeValue<string>("cr9cd_status");
            var created = existing.GetAttributeValue<DateTime>("createdon");
            var lifetimeMinutes = (Parse(existing.GetAttributeValue<string>("cr9cd_input"))["files"] as JArray)?.Count > 0 ? 240 : 10;
            var expired = (status == "queued" || status == "searching") && created != default(DateTime) && created < DateTime.UtcNow.AddMinutes(-lifetimeMinutes);
            var progress = Parse(existing.GetAttributeValue<string>("cr9cd_result") ?? "{}")["progress"] as JObject;
            var stage = Str(progress ?? new JObject(), "stage");
            var totalFiles = (Parse(existing.GetAttributeValue<string>("cr9cd_input"))["files"] as JArray)?.Count ?? 0;
            var safeProgress = progress != null && new[] { "starting", "uploading", "analyzing", "researching", "finalizing" }.Contains(stage)
                ? new JObject { ["stage"] = stage,
                    ["filesDone"] = Math.Max(0, Math.Min(totalFiles, Int32.TryParse(Str(progress, "filesDone"), out var filesDone) ? filesDone : 0)), ["totalFiles"] = totalFiles,
                    ["round"] = Math.Max(0, Math.Min(3, Int32.TryParse(Str(progress, "round"), out var round) ? round : 0)),
                    ["updatedAt"] = DateTimeOffset.TryParse(Str(progress, "updatedAt"), out var updated) ? updated.ToUniversalTime().ToString("o") : null }
                : null;
            return new JObject {
                ["id"] = id.ToString(), ["status"] = expired ? "failed" : status,
                ["startedAt"] = created == default(DateTime) ? null : created.ToUniversalTime().ToString("o"),
                ["progress"] = !expired && (status == "queued" || status == "searching") ? safeProgress : null,
                ["request"] = Parse(existing.GetAttributeValue<string>("cr9cd_input")),
                ["rawResult"] = status == "complete" ? Parse(existing.GetAttributeValue<string>("cr9cd_result")) : null,
                ["error"] = expired ? "This search took too long. Try a narrower team/date query." : existing.GetAttributeValue<string>("cr9cd_error")
            };
        }
    }
}
