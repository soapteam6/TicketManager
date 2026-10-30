using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Query;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Ais.TicketReview
{
    // A synchronous Custom API. All native rows and the workspace revision are committed
    // by the same Dataverse transaction. Directory reads use the built-in Entra
    // virtual table; there is no direct HTTP call or message delivery.
    public sealed partial class ReviewApi : IPlugin
    {
        private const string Scope = "ais-ticket-review-v1";
        private static readonly Guid WorkspaceId = new Guid("f18b973a-2936-44e5-aa55-271d7424aef3");
        private static readonly Dictionary<string, string> Tables = new Dictionary<string, string> {
            {"teams", "cr9cd_team"}, {"seasons", "cr9cd_season"}, {"games", "cr9cd_game"},
            {"seats", "cr9cd_seat"}, {"contacts", "cr9cd_contact_beneficiary"},
            {"requests", "cr9cd_ticketrequest"}, {"allocations", "cr9cd_assignment"}
        };
        private static readonly string[] Factors = {"strategicValue", "attendanceRate", "reliability", "salesOpportunity", "fairness", "employeeCustomerBalance", "leadTime", "premiumDemandBalance"};

        public void Execute(IServiceProvider provider)
        {
            var context = (IPluginExecutionContext)provider.GetService(typeof(IPluginExecutionContext));
            var trace = (ITracingService)provider.GetService(typeof(ITracingService));
            var factory = (IOrganizationServiceFactory)provider.GetService(typeof(IOrganizationServiceFactory));
            var service = factory.CreateOrganizationService(null);
            try
            {
                Check(context.IsInTransaction, "The review API requires a synchronous Dataverse transaction.");
                var actor = Actor(service, context.InitiatingUserId);
                var input = Parse((string)context.InputParameters["Payload"]);
                var operation = Str(input, "operation");
                Check(operation == "snapshot" || operation == "command" || operation == "seed" || operation == "directoryPreview" || operation == "scheduleSearchStart" || operation == "scheduleSearchGet", "Unsupported operation.");
                // The virtual table reads Graph as the authenticated caller, not
                // the elevated service used for transactional Ticket Manager rows.
                if (operation == "directoryPreview") {
                    RequireAdmin(actor);
                    var directory = ReadEntraDirectory(factory.CreateOrganizationService(context.InitiatingUserId));
                    context.OutputParameters["Result"] = new JObject { ["source"] = "Microsoft Entra ID", ["activeMembers"] = directory.Count, ["writes"] = 0 }.ToString(Formatting.None);
                    return;
                }
                if (operation == "scheduleSearchStart" || operation == "scheduleSearchGet") {
                    context.OutputParameters["Result"] = ScheduleSearch(service, actor, input).ToString(Formatting.None);
                    return;
                }
                if (operation != "snapshot" && Str(input["command"], "type") != "interest") RequireAdmin(actor);

                // Loading must never compete for a write lock. In particular, React
                // StrictMode, multiple tabs and refreshes may request the same snapshot.
                if (operation == "snapshot")
                {
                    context.OutputParameters["Result"] = ReadSnapshot(service, actor).ToString(Formatting.None);
                    return;
                }

                // Lock before reading native rows. RowVersion rejects competing callers and
                // the SQL write lock remains held until the complete API transaction commits.
                var workspace = service.Retrieve("cr9cd_reviewworkspace", WorkspaceId,
                    new ColumnSet("cr9cd_data", "cr9cd_revision", "cr9cd_lock"));
                var locked = new Entity(workspace.LogicalName, WorkspaceId) { RowVersion = workspace.RowVersion };
                locked["cr9cd_lock"] = Guid.NewGuid().ToString();
                service.Execute(new UpdateRequest { Target = locked, ConcurrencyBehavior = ConcurrencyBehavior.IfRowVersionMatches });
                var revision = workspace.GetAttributeValue<int>("cr9cd_revision");
                var settings = Parse(workspace.GetAttributeValue<string>("cr9cd_data"));
                var state = (JObject)settings.DeepClone();
                foreach (var pair in Tables)
                    state[pair.Key] = new JArray(Read(service, pair.Value,
                        new ConditionExpression("cr9cd_review_scope", ConditionOperator.Equal, Scope))
                        .Select(e => Parse(e.GetAttributeValue<string>("cr9cd_review_data"))));
                var before = (JObject)state.DeepClone();
                var now = DateTimeOffset.UtcNow;
                var result = new JObject { ["message"] = "Refreshed from AIS Development." };
                var operationId = Str(input, "operationId");
                var receipts = settings["receipts"] as JObject ?? new JObject();
                bool replay = operation != "snapshot" && receipts[operationId] != null;
                if (replay) result = (JObject)receipts[operationId].DeepClone();
                else if (operation != "snapshot")
                {
                    Check(Guid.TryParse(operationId, out _), "A unique operation ID is required.");
                    Check((int?)input["revision"] == revision, "Data changed in another session. Refresh and review before retrying.");
                    if (operation == "seed")
                    {
                        Check(Tables.Keys.All(k => !Rows(state, k).Any()), "This QA workspace is already seeded; it will not be overwritten.");
                        state = (JObject)input["state"].DeepClone();
                        foreach (var request in Rows(state, "requests")) { request["requesterId"] = actor["id"]; request["recordedBy"] = actor["id"]; }
                        foreach (var allocation in Rows(state, "allocations")) allocation["decidedBy"] = actor["id"];
                        foreach (var history in Rows(state, "attendanceHistory")) history["recordedBy"] = actor["id"];
                        // Employee choices come from enabled Entra member accounts.
                        state["contacts"] = new JArray(Rows(state, "contacts").Where(c => Str(c, "type") == "customer"));
                        SyncDirectory(factory.CreateOrganizationService(context.InitiatingUserId), state);
                        result["message"] = "QA fixtures created in native Dataverse tables.";
                    }
                    else result = Apply(service, state, actor, (JObject)input["command"], now, factory.CreateOrganizationService(context.InitiatingUserId));
                    Validate(state, now);
                    Persist(service, before, state);
                    revision++;
                    receipts[operationId] = result.DeepClone();
                    while (receipts.Count > 100) receipts.Properties().First().Remove();
                    var saved = (JObject)state.DeepClone();
                    foreach (var key in Tables.Keys) saved.Remove(key);
                    saved["receipts"] = receipts;
                    service.Update(new Entity(workspace.LogicalName, WorkspaceId) {
                        ["cr9cd_data"] = saved.ToString(Formatting.None), ["cr9cd_revision"] = revision
                    });
                }
                var response = new JObject {
                    ["revision"] = revision, ["serverNow"] = now.ToString("o"), ["result"] = result,
                    ["snapshot"] = Snapshot(service, state, actor, now)
                };
                if (IsAdmin(actor)) { state.Remove("receipts"); response["state"] = state; }
                context.OutputParameters["Result"] = response.ToString(Formatting.None);
            }
            catch (InvalidPluginExecutionException) { throw; }
            catch (Exception ex)
            {
                trace.Trace("Ticket review: {0}", ex);
                throw new InvalidPluginExecutionException("Dataverse review could not complete. No partial changes were committed. " + ex.Message);
            }
        }

        private static JObject ReadSnapshot(IOrganizationService service, JObject actor)
        {
            for (var attempt = 0; attempt < 3; attempt++)
            {
                var workspace = service.Retrieve("cr9cd_reviewworkspace", WorkspaceId,
                    new ColumnSet("cr9cd_data", "cr9cd_revision"));
                var revision = workspace.GetAttributeValue<int>("cr9cd_revision");
                var state = Parse(workspace.GetAttributeValue<string>("cr9cd_data"));
                foreach (var pair in Tables)
                    state[pair.Key] = new JArray(Read(service, pair.Value,
                        new ConditionExpression("cr9cd_review_scope", ConditionOperator.Equal, Scope))
                        .Select(e => Parse(e.GetAttributeValue<string>("cr9cd_review_data"))));
                var now = DateTimeOffset.UtcNow;
                var response = new JObject {
                    ["revision"] = revision, ["serverNow"] = now.ToString("o"),
                    ["result"] = new JObject { ["message"] = "Workspace refreshed." },
                    ["snapshot"] = Snapshot(service, state, actor, now)
                };
                if (IsAdmin(actor)) { state.Remove("receipts"); response["state"] = state; }
                // A committed edit increments the revision in the same transaction as
                // its row changes. Retry a read if a commit crossed the snapshot.
                var latest = service.Retrieve("cr9cd_reviewworkspace", WorkspaceId,
                    new ColumnSet("cr9cd_revision"));
                if (latest.GetAttributeValue<int>("cr9cd_revision") == revision) return response;
            }
            throw new InvalidPluginExecutionException("The workspace is changing. Please try loading it again.");
        }

        private static IEnumerable<Entity> Read(IOrganizationService service, string table, params ConditionExpression[] conditions)
        {
            var q = new QueryExpression(table) { ColumnSet = new ColumnSet(true), PageInfo = new PagingInfo { Count = 5000, PageNumber = 1 } };
            foreach (var c in conditions) q.Criteria.AddCondition(c);
            var rows = new List<Entity>();
            while (true) { var page = service.RetrieveMultiple(q); rows.AddRange(page.Entities); if (!page.MoreRecords) return rows; q.PageInfo.PageNumber++; q.PageInfo.PagingCookie = page.PagingCookie; }
        }
        private static JObject Actor(IOrganizationService service, Guid userId)
        {
            var user = service.Retrieve("systemuser", userId, new ColumnSet("fullname", "domainname", "internalemailaddress", "azureactivedirectoryobjectid", "isdisabled", "applicationid", "accessmode"));
            Check(!user.GetAttributeValue<bool>("isdisabled"), "This Dataverse account is disabled.");
            var appAdmin = IsAppAdmin(user);
            var roots = AppRoles(service);
            var direct = UserRoles(service, userId, false);
            var inherited = UserRoles(service, userId, true);
            var role = appAdmin ? "coordinator" : Highest(RoleKeys(direct.Concat(inherited), roots));
            Check(role != "none", "A Ticket Manager role is required. Ask an app admin to grant access.");
            return new JObject { ["key"] = role, ["id"] = userId.ToString(), ["isAppAdmin"] = appAdmin,
                ["name"] = user.GetAttributeValue<string>("fullname"), ["email"] = user.GetAttributeValue<string>("internalemailaddress"),
                ["directoryId"] = user.GetAttributeValue<Guid>("azureactivedirectoryobjectid").ToString(), ["role"] = role == "coordinator" ? "coordinator" : "requester" };
        }
        private static bool IsAdmin(JObject actor) => Str(actor, "role") == "coordinator";
        private static void RequireAdmin(JObject actor) => Check(IsAdmin(actor), "Coordinator permission is required.");
        private static JObject Parse(string json) {
            using (var reader = new JsonTextReader(new StringReader(json)) { DateParseHandling = DateParseHandling.None })
                return JObject.Load(reader);
        }
        private static string Str(JToken o, string key) => (string)o?[key] ?? "";
        private static IEnumerable<JObject> Rows(JObject s, string key) => ((JArray)s[key]).Cast<JObject>();
        private static JObject Find(JObject s, string key, string id) => Rows(s, key).FirstOrDefault(x => Str(x, "id") == id) ?? throw new InvalidPluginExecutionException("Record not found in this QA workspace.");
        private static bool Active(JObject a) => Str(a, "status") != "cancelled";
        private static bool Eligible(JObject c) => (bool)c["appActive"] && (bool)c["directoryActive"];
        private static string NewId() => Guid.NewGuid().ToString();
        private static void Check(bool ok, string message) { if (!ok) throw new InvalidPluginExecutionException(message); }
        private static string Text(JToken o, string key, int max = 1000) { var value = Str(o, key).Trim(); Check(value.Length > 0 && value.Length <= max, $"Enter {key} (up to {max} characters)."); return value; }
        private static int Number(JToken o, string key, int min, int max) { Check(o?[key]?.Type == JTokenType.Integer, $"{key} must be an integer."); var n = (int)o[key]; Check(n >= min && n <= max, $"{key} must be {min} to {max}."); return n; }
        private static DateTimeOffset Instant(string value) { Check(Regex.IsMatch(value, @"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$") && DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out _), "Enter a real ISO timestamp with seconds and timezone."); return DateTimeOffset.Parse(value, CultureInfo.InvariantCulture); }
        private static bool Released(JObject g, DateTimeOffset now) => Str(g, "release") == "released" || (Str(g, "release") == "scheduled" && Instant(Str(g, "releaseAt")) <= now);
        private static void Add(JObject s, string key, JObject row) => ((JArray)s[key]).Add(row);

        private static JObject Apply(IOrganizationService service, JObject s, JObject actor, JObject c, DateTimeOffset now, IOrganizationService directoryService = null)
        {
            Check(c != null, "A command is required.");
            var type = Str(c, "type");
            if (type != "interest") RequireAdmin(actor);
            var result = new JObject { ["message"] = "Saved to AIS Development." };
            switch (type)
            {
                case "setUserRole":
                    SetUserRole(service, actor, c); break;
                case "setGroupRole":
                    SetGroupRole(service, actor, c); break;
                case "connectGroup":
                    result["id"] = ConnectGroup(service, actor, c); break;
                case "createTeam":
                    var team = new JObject { ["id"] = NewId(), ["name"] = Text(c, "name", 200), ["defaultTickets"] = Number(c, "defaultTickets", 0, 1000) };
                    Add(s, "teams", team); result["id"] = team["id"]; break;
                case "createSeason":
                    Find(s, "teams", Str(c, "teamId"));
                    foreach (var field in new[] {"startDate", "endDate"}) Check(DateTime.TryParseExact(Str(c, field), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out _), "Enter a real calendar date.");
                    Check(String.CompareOrdinal(Str(c, "startDate"), Str(c, "endDate")) <= 0, "Season end precedes start.");
                    var season = new JObject { ["id"] = NewId(), ["teamId"] = c["teamId"], ["label"] = Text(c, "label", 200), ["startDate"] = c["startDate"], ["endDate"] = c["endDate"] };
                    Add(s, "seasons", season); result["id"] = season["id"]; break;
                case "createInventory": result["id"] = AddInventory(s, c); break;
                case "editInventory": EditInventory(s, c, now); break;
                case "removeInventory": RemoveInventory(s, Str(c, "gameId")); break;
                case "importSchedule":
                    var importSeasonId = Str(c, "seasonId");
                    if (c["newSeason"] is JObject draft) {
                        Check(String.IsNullOrEmpty(importSeasonId), "Choose an existing season or a new season, not both.");
                        var importTeamId = Str(draft, "teamId");
                        if (String.IsNullOrEmpty(importTeamId)) {
                            var importName = Text(draft, "teamName", 200);
                            var matchingTeam = Rows(s, "teams").FirstOrDefault(t => String.Equals(Str(t, "name"), importName, StringComparison.OrdinalIgnoreCase));
                            importTeamId = matchingTeam != null ? Str(matchingTeam, "id") : Str(Apply(service, s, actor, new JObject { ["type"] = "createTeam", ["name"] = importName, ["defaultTickets"] = draft["defaultTickets"] }, now), "id");
                        }
                        Check(!Rows(s, "seasons").Any(x => Str(x, "teamId") == importTeamId && String.Equals(Str(x, "label"), Str(draft, "label").Trim(), StringComparison.OrdinalIgnoreCase)), "A season with that label already exists for this team. Select it from the list.");
                        importSeasonId = Str(Apply(service, s, actor, new JObject { ["type"] = "createSeason", ["teamId"] = importTeamId, ["label"] = draft["label"], ["startDate"] = draft["startDate"], ["endDate"] = draft["endDate"] }, now), "id");
                    }
                    Find(s, "seasons", importSeasonId);
                    var lines = Str(c, "csv").Split('\n').Select(x => x.TrimEnd('\r')).Where(x => !String.IsNullOrWhiteSpace(x) && !x.StartsWith("#")).ToList();
                    if (lines.Count > 0 && lines[0].StartsWith("date,", StringComparison.OrdinalIgnoreCase)) lines.RemoveAt(0);
                    Check(lines.Count > 0 && lines.Count <= 100, "Import 1 to 100 rows per transaction.");
                    foreach (var line in lines) {
                        var cells = Csv(line); Check(cells.Count == 5, "Each CSV row must contain exactly five columns.");
                        Check(Regex.IsMatch(cells[0], @"^\d{4}-\d{2}-\d{2}$") && Regex.IsMatch(cells[1], @"^\d{2}:\d{2}$"), "Use YYYY-MM-DD and HH:mm UTC.");
                        Check(Int32.TryParse(cells[3], out var tickets), "Ticket quantity must be an integer.");
                        AddInventory(s, new JObject { ["gameDate"] = cells[0] + "T" + cells[1] + ":00Z", ["title"] = cells[2], ["tickets"] = tickets, ["kind"] = cells[4], ["seasonId"] = importSeasonId });
                    } break;
                case "release":
                    var action = Str(c, "action"); Check(new[] {"private", "released", "scheduled"}.Contains(action), "Choose a visibility action.");
                    if (action == "scheduled") Instant(Str(c, "at"));
                    var ids = c["ids"] as JArray;
                    if (ids != null) { Check(ids.Count > 0, "Select inventory."); foreach (var id in ids) Find(s, "games", (string)id); }
                    else { Instant(Str(c, "from")); Instant(Str(c, "through")); Check(Instant(Str(c, "from")) <= Instant(Str(c, "through")), "Release window is reversed."); }
                    var targets = Rows(s, "games").Where(g => ids != null ? ids.Values<string>().Contains(Str(g, "id")) : Instant(Str(g, "gameDate")) >= Instant(Str(c, "from")) && Instant(Str(g, "gameDate")) <= Instant(Str(c, "through"))).ToList();
                    Check(targets.Count > 0, "No inventory selected.");
                    foreach (var g in targets) { g["release"] = action; g["releaseAt"] = action == "scheduled" ? c["at"] : JValue.CreateNull(); } break;
                case "interest":
                    var game = Find(s, "games", Str(c, "gameId"));
                    Check(Str(game, "status") == "scheduled" && Instant(Str(game, "gameDate")) > now, "Choose a future scheduled event.");
                    Check(IsAdmin(actor) || Released(game, now), "Inventory is private.");
                    var quantity = Number(c, "quantity", 1, 100); var purpose = Str(c, "purpose");
                    Check(purpose == "customer" || purpose == "employee", "Choose a purpose.");
                    Check(IsAdmin(actor) || Str(actor, "key") != "employee" || purpose == "employee", "Employees request for self.");
                    var requester = InterestRequester(service, s, actor, c);
                    var contacts = InterestCrmContacts(s, c);
                    if (contacts.Count == 0) contacts = ((JArray)c["contactIds"]).Values<string>().Distinct().Select(id => Find(s, "contacts", id)).ToList();
                    Check(contacts.Count > 0 && contacts.Count <= quantity && contacts.All(x => Eligible(x) && Str(x, "type") == purpose), "Select eligible contacts matching the purpose.");
                    Check(purpose != "customer" || contacts.Select(x => Str(x, "company")).Distinct().Count() == 1, "Select contacts from one business.");
                    Check(purpose != "employee" || contacts.Count == 1 && String.Equals(Str(contacts[0], "directoryId"), Str(requester, "directoryId"), StringComparison.OrdinalIgnoreCase), "Employee interest must have only the requesting person as beneficiary.");
                    var interest = new JObject { ["id"] = NewId(), ["gameId"] = game["id"], ["requesterId"] = requester["id"], ["requesterDirectoryId"] = requester["directoryId"], ["requesterContactId"] = requester["contactId"], ["requesterName"] = requester["name"], ["requesterEmail"] = requester["email"], ["recordedBy"] = actor["id"],
                        ["purpose"] = purpose, ["contactIds"] = new JArray(contacts.Select(x => Str(x, "id"))), ["quantity"] = quantity,
                        ["rationale"] = Text(c, "rationale"), ["opportunity"] = Str(c, "opportunity").Trim(), ["status"] = "submitted", ["createdAt"] = now.ToString("o") };
                    Add(s, "requests", interest); result["id"] = interest["id"]; result["message"] = "Interest saved. No tickets reserved."; break;
                case "waitlist":
                    var wait = Find(s, "requests", Str(c, "requestId"));
                    Check(Active(wait) && !Rows(s, "allocations").Any(a => Str(a, "requestId") == Str(wait, "id") && Active(a)), "Choose active interest without allocations.");
                    wait["status"] = "waitlisted"; result["message"] = "Waitlisted. No seats held or automatically allocated."; break;
                case "allocate":
                    var req = Find(s, "requests", Str(c, "requestId")); Check(Active(req), "Request is cancelled.");
                    var count = Number(c, "quantity", 1, 100); var reason = Text(c, "reason");
                    var beneficiaries = ((JArray)req["contactIds"]).Values<string>().ToList();
                    Check(beneficiaries.All(id => Eligible(Find(s, "contacts", id))), "Inactive beneficiaries cannot receive tickets.");
                    var held = Rows(s, "allocations").Count(a => Str(a, "requestId") == Str(req, "id") && Active(a));
                    var pool = Rows(s, "seats").Where(x => Str(x, "gameId") == Str(req, "gameId") && Str(x, "status") == "available").OrderBy(x => Str(x, "id")).Take(count).ToList();
                    Check(count <= (int)req["quantity"] - held && pool.Count == count, "Allocation conflict: insufficient tickets or request already fulfilled.");
                    for (var i = 0; i < count; i++) { var seat = pool[i]; seat["status"] = "assigned";
                        Add(s, "allocations", new JObject { ["id"] = NewId(), ["requestId"] = req["id"], ["gameId"] = req["gameId"], ["seatId"] = seat["id"],
                            ["contactId"] = beneficiaries[Math.Min(beneficiaries.Count - 1, held + i)], ["status"] = "approved", ["decision"] = reason,
                            ["decidedBy"] = actor["id"], ["transferReference"] = "", ["outcome"] = "unknown", ["evidence"] = "" }); }
                    req["status"] = held + count == (int)req["quantity"] ? "fulfilled" : "partially_fulfilled";
                    result["message"] = "Allocation committed in Dataverse. Transfer remains manual."; break;
                case "cancelAllocation":
                    var cancel = Find(s, "allocations", Str(c, "assignmentId"));
                    if (Active(cancel)) { cancel["status"] = "cancelled"; Find(s, "seats", Str(cancel, "seatId"))["status"] = "available";
                        Find(s, "requests", Str(cancel, "requestId"))["status"] = Rows(s, "allocations").Any(a => Str(a, "requestId") == Str(cancel, "requestId") && Active(a)) ? "partially_fulfilled" : "submitted"; }
                    result["message"] = "Allocation cancelled; history retained. No automatic waitlist promotion."; break;
                case "manualTransfer":
                    var transfer = Find(s, "allocations", Str(c, "assignmentId")); Check(Active(transfer) && (bool?)c["confirmed"] == true, "Confirm a manual transfer for an active allocation.");
                    transfer["transferReference"] = Text(c, "reference", 200); transfer["status"] = "transferred";
                    Find(s, "seats", Str(transfer, "seatId"))["status"] = "transferred";
                    result["message"] = "Manual transfer confirmation saved. No provider contacted."; break;
                case "attendance":
                    var attendance = Find(s, "allocations", Str(c, "assignmentId")); Check(Active(attendance), "Choose an active allocation.");
                    var outcome = Str(c, "outcome"); Check(new[] {"unknown", "attended", "no_show"}.Contains(outcome), "Choose an attendance outcome.");
                    Check(outcome == "unknown" || Instant(Str(Find(s, "games", Str(attendance, "gameId")), "gameDate")) <= now, "Attendance cannot be confirmed before the event.");
                    if (outcome != "unknown") Text(c, "evidence");
                    Check(Str(c, "evidence").Length <= 1000, "Evidence is too long.");
                    attendance["outcome"] = outcome; attendance["evidence"] = Str(c, "evidence").Trim();
                    Add(s, "attendanceHistory", new JObject { ["assignmentId"] = attendance["id"], ["outcome"] = outcome, ["evidence"] = attendance["evidence"], ["recordedAt"] = now.ToString("o"), ["recordedBy"] = actor["id"] }); break;
                case "contactActive": Find(s, "contacts", Str(c, "contactId"))["appActive"] = (bool)c["active"]; break;
                case "saveContact":
                    var details = (JObject)c["contact"]; Text(details, "name", 200); Text(details, "company", 200);
                    Check(Str(details, "email").Length == 0 || Regex.IsMatch(Str(details, "email"), @"^[^\s@]+@[^\s@]+\.[^\s@]+$"), "Enter a valid email.");
                    Check(new[] {"platinum", "gold", "silver", "bronze", "prospect"}.Contains(Str(details, "tier")), "Choose a value tier.");
                    var contact = String.IsNullOrEmpty(Str(c, "id")) ? new JObject { ["id"] = NewId(), ["type"] = "customer", ["appActive"] = true, ["directoryActive"] = true, ["directoryId"] = JValue.CreateNull() } : Find(s, "contacts", Str(c, "id"));
                    foreach (var field in new[] {"name", "company", "email", "phone", "tier"}) contact[field] = details[field];
                    if (String.IsNullOrEmpty(Str(c, "id"))) Add(s, "contacts", contact); break;
                case "syncDirectory":
                    Check(directoryService != null, "The authenticated Entra directory connection is unavailable.");
                    result["directory"] = SyncDirectory(directoryService, s);
                    result["message"] = "Employee contacts refreshed from Microsoft Entra ID. App eligibility retained.";
                    break;
                case "scoring":
                    var scoring = (JObject)c["settings"]; Check(scoring != null, "Scoring settings are required.");
                    foreach (var f in Factors) { var v = (double?)scoring["weights"]?[f]; Check(v.HasValue && !Double.IsNaN(v.Value) && v >= 0 && v <= 1, "Weights must be between zero and one."); }
                    foreach (var f in new[] {"attendanceRate", "employeeCustomerBalance", "leadTime", "premiumDemandBalance"}) Check((double)scoring["weights"][f] == 0, "This advisory factor is disabled.");
                    Check(Factors.Any(f => (double)scoring["weights"][f] > 0), "Enable an advisory factor.");
                    foreach (var f in new[] {"customer", "prospect", "employee"}) { var v = (double?)scoring["category"]?[f]; Check(v.HasValue && v >= 0 && v <= 1, "Category values must be zero to one."); }
                    s["scoring"] = scoring.DeepClone(); break;
                case "availability":
                    Check(new[] {"sales_team", "everyone"}.Contains(Str(c, "audience")), "Choose an audience.");
                    Add(s, "outbox", new JObject { ["id"] = NewId(), ["kind"] = "availability", ["subject"] = "Tickets available - express interest", ["body"] = Text(c, "body", 2000), ["audience"] = c["audience"], ["createdAt"] = now.ToString("o") });
                    result["message"] = "Preview saved to QA outbox. Nothing sent."; break;
                case "followupTemplate": Text(c["template"], "subject", 200); Text(c["template"], "body", 2000); s["followup"] = c["template"].DeepClone(); break;
                case "followupOutbox": Check((bool)s["followup"]["enabled"], "Enable and save the optional template first.");
                    Add(s, "outbox", new JObject { ["id"] = NewId(), ["kind"] = "followup", ["subject"] = s["followup"]["subject"], ["body"] = s["followup"]["body"], ["audience"] = "QA preview audience", ["createdAt"] = now.ToString("o") });
                    result["message"] = "Follow-up preview saved. Nothing sent."; break;
                default: throw new InvalidPluginExecutionException("Unsupported review command.");
            }
            return result;
        }

        private static string AddInventory(JObject s, JObject c)
        {
            var title = Text(c, "title", 200); var date = Instant(Str(c, "gameDate")); var tickets = Number(c, "tickets", 0, 1000); var kind = Str(c, "kind");
            Check(kind == "game" || kind == "event", "Choose game or event.");
            if (kind == "game") Find(s, "seasons", Str(c, "seasonId"));
            Check(!Rows(s, "games").Any(g => (bool?)g["removed"] != true && Str(g, "title") == title && Instant(Str(g, "gameDate")) == date), "Duplicate dated inventory.");
            var id = NewId(); Add(s, "games", new JObject { ["id"] = id, ["kind"] = kind, ["title"] = title, ["seasonId"] = kind == "game" ? c["seasonId"] : JValue.CreateNull(),
                ["gameDate"] = date.ToString("o"), ["totalTickets"] = tickets, ["status"] = "scheduled", ["release"] = "private", ["releaseAt"] = JValue.CreateNull() });
            for (var i = 0; i < tickets; i++) Add(s, "seats", new JObject { ["id"] = NewId(), ["gameId"] = id, ["label"] = "Ticket " + (i + 1), ["status"] = "available" });
            return id;
        }
        private static List<string> Csv(string line)
        {
            var cells = new List<string>(); var cell = ""; bool quoted = false;
            for (var i = 0; i < line.Length; i++) { var ch = line[i];
                if (ch == '"' && quoted && i + 1 < line.Length && line[i + 1] == '"') { cell += '"'; i++; }
                else if (ch == '"') quoted = !quoted;
                else if (ch == ',' && !quoted) { cells.Add(cell.Trim()); cell = ""; }
                else cell += ch;
            } Check(!quoted, "Unclosed CSV quote."); cells.Add(cell.Trim()); return cells;
        }
        private static void Validate(JObject s, DateTimeOffset now)
        {
            foreach (var key in Tables.Keys) { var ids = Rows(s, key).Select(x => Str(x, "id")).ToList(); Check(ids.All(x => Guid.TryParse(x, out _)) && ids.Distinct().Count() == ids.Count, "Duplicate or invalid record IDs."); }
            foreach (var g in Rows(s, "games")) {
                Instant(Str(g, "gameDate")); Check(new[] {"private", "released", "scheduled"}.Contains(Str(g, "release")), "Invalid release status.");
                if (Str(g, "release") == "scheduled") Instant(Str(g, "releaseAt"));
                if (Str(g, "kind") == "game") Find(s, "seasons", Str(g, "seasonId"));
                Check(Rows(s, "seats").Count(x => Str(x, "gameId") == Str(g, "id")) == (int)g["totalTickets"], "Ticket capacity mismatch.");
            }
            foreach (var r in Rows(s, "requests")) { Find(s, "games", Str(r, "gameId")); Number(r, "quantity", 1, 100); foreach (var id in ((JArray)r["contactIds"]).Values<string>()) Find(s, "contacts", id); }
            var active = Rows(s, "allocations").Where(Active).ToList();
            Check(active.Select(a => Str(a, "seatId")).Distinct().Count() == active.Count, "A ticket has multiple active allocations.");
            foreach (var a in Rows(s, "allocations")) {
                var request = Find(s, "requests", Str(a, "requestId")); var seat = Find(s, "seats", Str(a, "seatId"));
                Find(s, "contacts", Str(a, "contactId")); Check(Str(request, "gameId") == Str(a, "gameId") && Str(seat, "gameId") == Str(a, "gameId"), "Allocation belongs to another event.");
                if (Str(a, "outcome") == "no_show") Text(a, "evidence");
                Check(Str(a, "outcome") == "unknown" || Instant(Str(Find(s, "games", Str(a, "gameId")), "gameDate")) <= now, "Future attendance is invalid.");
            }
            foreach (var r in Rows(s, "requests")) Check(active.Count(a => Str(a, "requestId") == Str(r, "id")) <= (int)r["quantity"], "Allocation exceeds requested quantity.");
            foreach (var seat in Rows(s, "seats")) { var owner = active.FirstOrDefault(a => Str(a, "seatId") == Str(seat, "id")); Check((Str(seat, "status") == "available") == (owner == null), "Seat state is inconsistent."); }
        }

        private static JObject Snapshot(IOrganizationService service, JObject s, JObject actor, DateTimeOffset now)
        {
            var admin = IsAdmin(actor); var actorId = Str(actor, "id");
            var identities = new Dictionary<string, Entity>();
            {
                var ids = Rows(s, "requests").SelectMany(r => new[] { Str(r, "requesterId"), Str(r, "recordedBy") })
                    .Concat(new[] { actorId }).Where(id => Guid.TryParse(id, out _)).Select(Guid.Parse).Distinct().Cast<object>().ToArray();
                var query = new QueryExpression("systemuser") { ColumnSet = new ColumnSet("fullname", "internalemailaddress", "azureactivedirectoryobjectid") };
                query.Criteria.AddCondition(new ConditionExpression("systemuserid", ConditionOperator.In, ids));
                identities = service.RetrieveMultiple(query).Entities.ToDictionary(u => u.Id.ToString());
            }
            var catalog = new JArray();
            foreach (var g in Rows(s, "games").Where(g => (bool?)g["removed"] != true && (admin || Released(g, now) && Str(g, "status") == "scheduled" && Instant(Str(g, "gameDate")) > now))) {
                var row = (JObject)g.DeepClone(); var id = Str(g, "id"); var requests = Rows(s, "requests").Where(r => Str(r, "gameId") == id && Active(r)).ToList();
                row["released"] = Released(g, now); row["availableTickets"] = Rows(s, "seats").Count(x => Str(x, "gameId") == id && Str(x, "status") == "available");
                row["requestCount"] = requests.Count; row["requestingPeople"] = requests.Select(r => !String.IsNullOrEmpty(Str(r, "requesterDirectoryId")) ? Str(r, "requesterDirectoryId") : identities.TryGetValue(Str(r, "requesterId"), out var identity) && identity.GetAttributeValue<Guid>("azureactivedirectoryobjectid") != Guid.Empty ? identity.GetAttributeValue<Guid>("azureactivedirectoryobjectid").ToString() : Str(r, "requesterId")).Distinct(StringComparer.OrdinalIgnoreCase).Count(); row["requestedTickets"] = requests.Sum(r => (int)r["quantity"]);
                var season = Rows(s, "seasons").FirstOrDefault(x => Str(x, "id") == Str(g, "seasonId"));
                row["seasonLabel"] = season?["label"];
                row["seasonStartDate"] = season?["startDate"];
                row["seasonEndDate"] = season?["endDate"];
                row["teamId"] = season?["teamId"];
                row["teamName"] = Rows(s, "teams").FirstOrDefault(x => Str(x, "id") == Str(season, "teamId"))?["name"];
                catalog.Add(row);
            }
            var projected = new JArray();
            foreach (var r in Rows(s, "requests").Where(r => admin || OwnInterest(r, actor))) {
                var row = new JObject(); foreach (var k in new[] {"id", "gameId", "quantity", "purpose", "rationale", "opportunity", "status", "createdAt"}) row[k] = r[k].DeepClone();
                var ids = ((JArray)r["contactIds"]).Values<string>().ToList(); row["contactNames"] = String.Join(", ", ids.Select(id => Str(Find(s, "contacts", id), "name")));
                row["allocated"] = Rows(s, "allocations").Count(a => Str(a, "requestId") == Str(r, "id") && Active(a));
                if (admin) {
                    row["contactIds"] = r["contactIds"].DeepClone(); row["requesterId"] = r["requesterId"];
                    row["requesterName"] = r["requesterName"]; row["requesterEmail"] = r["requesterEmail"];
                    if (identities.TryGetValue(Str(r, "requesterId"), out var requester)) {
                        row["requesterName"] = requester.GetAttributeValue<string>("fullname");
                        row["requesterEmail"] = requester.GetAttributeValue<string>("internalemailaddress");
                    }
                    row["recordedById"] = r["recordedBy"];
                    if (identities.TryGetValue(Str(r, "recordedBy"), out var recorder)) row["recordedByName"] = recorder.GetAttributeValue<string>("fullname");
                    row["confirmedNoShows"] = Rows(s, "allocations").Count(a => ids.Contains(Str(a, "contactId")) && Str(a, "outcome") == "no_show");
                }
                projected.Add(row);
            }
            var options = new JArray();
            foreach (var c in Rows(s, "contacts").Where(c => Eligible(c) && (admin || Str(c, "type") == "customer" && Str(actor, "key") == "rep" || Str(c, "directoryId") == Str(actor, "directoryId")))) {
                var option = new JObject(); foreach (var k in new[] {"id", "type", "name", "company", "email", "phone"}) option[k] = c[k].DeepClone(); options.Add(option);
            }
            var snapshot = new JObject { ["mode"] = "dataverse", ["persona"] = actor, ["catalog"] = catalog, ["requests"] = projected, ["options"] = options,
                ["teams"] = admin ? s["teams"].DeepClone() : new JArray(), ["seasons"] = admin ? s["seasons"].DeepClone() : new JArray() };
            if ((bool?)actor["isAppAdmin"] == true) {
                snapshot["accessUsers"] = AccessUsers(service);
                snapshot["accessGroups"] = AccessGroups(service);
            }
            if (admin) {
                snapshot["scheduleSearchAvailable"] = ScheduleSearchAvailable(service);
                foreach (var k in new[] {"contacts", "allocations", "attendanceHistory", "outbox", "followup", "scoring"}) snapshot[k] = s[k].DeepClone();
                snapshot["requesters"] = new JArray(Read(service, "systemuser", new ConditionExpression("isdisabled", ConditionOperator.Equal, false), new ConditionExpression("accessmode", ConditionOperator.Equal, 0))
                    .Where(u => u.GetAttributeValue<Guid>("azureactivedirectoryobjectid") != Guid.Empty && u.GetAttributeValue<Guid>("applicationid") == Guid.Empty
                        && IsDirectoryPerson(u.GetAttributeValue<string>("fullname"), u.GetAttributeValue<string>("internalemailaddress"), u.GetAttributeValue<string>("domainname")))
                    .Select(u => new JObject { ["id"] = u.Id.ToString(), ["name"] = u.GetAttributeValue<string>("fullname"), ["email"] = u.GetAttributeValue<string>("internalemailaddress") }));
            }
            return snapshot;
        }

        private static void Persist(IOrganizationService service, JObject before, JObject after)
        {
            var retainedSeats = new HashSet<string>(Rows(after, "seats").Select(row => Str(row, "id")));
            var deletedSeats = Rows(before, "seats").Where(row => !retainedSeats.Contains(Str(row, "id"))).ToList();
            foreach (var seat in deletedSeats) {
                Check(Str(seat, "status") == "available" && !Read(service, "cr9cd_assignment", new ConditionExpression("cr9cd_seat", ConditionOperator.Equal, Guid.Parse(Str(seat, "id")))).Any(),
                    "A ticket with allocation history cannot be removed.");
            }
            foreach (var pair in Tables) {
                var old = Rows(before, pair.Key).ToDictionary(x => Str(x, "id"));
                foreach (var row in Rows(after, pair.Key)) {
                    var id = Str(row, "id"); if (old.TryGetValue(id, out var previous) && JToken.DeepEquals(previous, row)) continue;
                    var entity = Native(pair.Key, row); entity["cr9cd_review_scope"] = Scope; entity["cr9cd_review_data"] = row.ToString(Formatting.None);
                    if (old.ContainsKey(id)) service.Update(entity);
                    else { Check(!Read(service, pair.Value, new ConditionExpression(pair.Value + "id", ConditionOperator.Equal, Guid.Parse(id))).Any(), "Fixture ID collides with existing data."); service.Create(entity); }
                }
            }
            // Only unused ticket rows removed by a capacity edit are deleted.
            // Events themselves are retained and hidden with a removal marker.
            foreach (var seat in deletedSeats) service.Delete(Tables["seats"], Guid.Parse(Str(seat, "id")));
        }
        private static void Ref(Entity e, string field, string table, JToken value) { var id = (string)value; if (!String.IsNullOrEmpty(id)) e[field] = new EntityReference(table, Guid.Parse(id)); }
        private static void Choice(Entity e, string field, string value, params string[] choices) { var index = Array.IndexOf(choices, value); Check(index >= 0, "Invalid choice for " + field); e[field] = new OptionSetValue(100000000 + index); }
        private static Entity Native(string key, JObject r)
        {
            var e = new Entity(Tables[key], Guid.Parse(Str(r, "id"))); e["cr9cd_name"] = "[QA] " + (Str(r, "name") + Str(r, "label") + Str(r, "title") + Str(r, "id")).Substring(0, Math.Min(80, (Str(r, "name") + Str(r, "label") + Str(r, "title") + Str(r, "id")).Length));
            switch (key) {
                case "teams": e["cr9cd_default_tickets_per_game"] = (int)r["defaultTickets"]; break;
                case "seasons": Ref(e, "cr9cd_team", "cr9cd_team", r["teamId"]); e["cr9cd_start_date"] = DateTime.Parse(Str(r, "startDate"), CultureInfo.InvariantCulture); e["cr9cd_end_date"] = DateTime.Parse(Str(r, "endDate"), CultureInfo.InvariantCulture); Choice(e, "cr9cd_status", "active", "draft", "active", "archived", "completed"); break;
                case "games": e["cr9cd_season"] = String.IsNullOrEmpty(Str(r, "seasonId")) ? null : new EntityReference("cr9cd_season", Guid.Parse(Str(r, "seasonId"))); e["cr9cd_game_date"] = Instant(Str(r, "gameDate")).UtcDateTime; e["cr9cd_title"] = Str(r, "title"); e["cr9cd_opponent"] = Str(r, "kind") == "game" ? Str(r, "title") : ""; e["cr9cd_total_seats"] = (int)r["totalTickets"]; Choice(e, "cr9cd_kind", Str(r, "kind"), "game", "event"); Choice(e, "cr9cd_status", Str(r, "status"), "scheduled", "transfer_pending", "completed", "cancelled"); break;
                case "seats": Ref(e, "cr9cd_game", "cr9cd_game", r["gameId"]); e["cr9cd_seat_number"] = Str(r, "label"); Choice(e, "cr9cd_status", Str(r, "status"), "available", "held", "assigned", "transferred", "cancelled"); break;
                case "contacts": e["cr9cd_name"] = "[QA] " + Str(r, "name"); e["cr9cd_company"] = Str(r, "company"); e["cr9cd_email"] = Str(r, "email"); e["cr9cd_phone"] = Str(r, "phone"); Choice(e, "cr9cd_type", Str(r, "type"), "customer", "employee"); Choice(e, "cr9cd_value_tier", Str(r, "tier"), "platinum", "gold", "silver", "bronze", "prospect"); break;
                case "requests": Ref(e, "cr9cd_game", "cr9cd_game", r["gameId"]); Ref(e, "cr9cd_beneficiary_contact", "cr9cd_contact_beneficiary", r["contactIds"]?.First); e["cr9cd_quantity"] = (int)r["quantity"]; e["cr9cd_narrative"] = Str(r, "rationale"); e["cr9cd_crm_opportunity_name"] = Str(r, "opportunity"); Choice(e, "cr9cd_beneficiary_type", Str(r, "purpose"), "customer", "employee"); Choice(e, "cr9cd_status", Str(r, "status"), "submitted", "scored", "recommended", "approved", "partially_fulfilled", "fulfilled", "waitlisted", "declined", "cancelled"); break;
                case "allocations": Ref(e, "cr9cd_game", "cr9cd_game", r["gameId"]); Ref(e, "cr9cd_ticket_request", "cr9cd_ticketrequest", r["requestId"]); Ref(e, "cr9cd_seat", "cr9cd_seat", r["seatId"]); Ref(e, "cr9cd_beneficiary_contact", "cr9cd_contact_beneficiary", r["contactId"]); Ref(e, "cr9cd_approved_by", "systemuser", r["decidedBy"]); e["cr9cd_transfer_ref"] = Str(r, "transferReference"); Choice(e, "cr9cd_status", Str(r, "status"), "proposed", "approved", "transferred", "declined", "cancelled"); break;
            }
            return e;
        }
    }
}
