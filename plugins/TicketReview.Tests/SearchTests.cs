using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Ais.TicketReview;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Newtonsoft.Json.Linq;

internal static class SearchTests
{
    private static readonly Guid User = Guid.NewGuid(), Season = Guid.NewGuid();
    private static JObject Actor(string role = "coordinator") => new JObject { ["id"] = User.ToString(), ["role"] = role };
    private static JObject Input(Guid id, string query = "Las Vegas schedule 2027") => new JObject {
        ["operation"] = "scheduleSearchStart", ["jobId"] = id.ToString(), ["request"] = new JObject {
            ["query"] = query, ["seasonId"] = Season.ToString(), ["ticketsPerEvent"] = 4, ["homeOnly"] = true,
            ["requestedBy"] = Guid.NewGuid().ToString(), ["today"] = "1900-01-01"
        }
    };
    private static JObject Call(Fake service, JObject actor, JObject input)
    {
        try { return (JObject)typeof(ReviewApi).GetMethod("ScheduleSearch", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] { service, actor, input }); }
        catch (TargetInvocationException ex) { throw ex.InnerException; }
    }
    private static void Assert(bool ok, string message) { if (!ok) throw new Exception(message); }
    private static void Denied(Action run, string expected)
    {
        try { run(); } catch (InvalidPluginExecutionException ex) { Assert(ex.Message.Contains(expected), ex.Message); return; }
        throw new Exception("Expected search rejection: " + expected);
    }
    public static int Run()
    {
        var tests = new Dictionary<string, Action> {
            ["requesters cannot start or poll a search"] = () => {
                var service = new Fake(); var input = Input(Guid.NewGuid());
                Denied(() => Call(service, Actor("requester"), input), "Coordinator");
                input["operation"] = "scheduleSearchGet";
                Denied(() => Call(service, Actor("requester"), input), "Coordinator");
                Assert(service.Writes == 0, "Requester caused a write");
            },
            ["file-only preparation stores owned Notes and metadata without echoing file contents"] = () => {
                var service = new Fake(); var input = Input(Guid.NewGuid(), "");
                input["request"]["files"] = new JArray(new JObject { ["name"] = "Tracker.xlsx", ["mediaType"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ["size"] = 6, ["data"] = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("sample")) });
                var result = Call(service, Actor(), input);
                Assert(service.Jobs.Count == 1 && service.Notes.Count == 1 && service.Writes == 2, "File and job not saved together");
                Assert((string)result["request"]["seasonId"] == Season.ToString() && result["request"]["from"].Type == JTokenType.Null && result["request"]["through"].Type == JTokenType.Null, "The destination season filtered games out of the uploaded tracker");
                Assert(!result.ToString().Contains("c2FtcGxl") && !service.Jobs[0].GetAttributeValue<string>("cr9cd_input").Contains("c2FtcGxl"), "File contents leaked into metadata");
                Assert(service.Notes[0].GetAttributeValue<EntityReference>("objectid").Id == service.Jobs[0].Id && (string)result["request"]["files"][0]["sha256"] != "", "File ownership/hash missing");
                Call(service, Actor(), input); Assert(service.Writes == 2, "Repeated job created duplicate attachments");
                input["request"]["files"][0]["data"] = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("change"));
                Denied(() => Call(service, Actor(), input), "already used"); Assert(service.Writes == 2, "Changed file overwrote prior job");
            },
            ["invalid file names encoding and size fail before a job is created"] = () => {
                foreach (var patch in new[] { new JObject { ["name"] = "bad\\name.xlsx" }, new JObject { ["data"] = "not base64!" }, new JObject { ["size"] = 7 }, new JObject { ["mediaType"] = "text/plain\\nheader" } }) {
                    var service = new Fake(); var input = Input(Guid.NewGuid()); var file = new JObject { ["name"] = "Tracker.xlsx", ["mediaType"] = "application/octet-stream", ["size"] = 6, ["data"] = "c2FtcGxl" }; file.Merge(patch); input["request"]["files"] = new JArray(file);
                    try { Call(service, Actor(), input); throw new Exception("Invalid upload accepted"); } catch (InvalidPluginExecutionException) { }
                    Assert(service.Writes == 0, "Invalid upload wrote data");
                }
            },
            ["search creation writes only a job owned by the authenticated caller"] = () => {
                var service = new Fake(); var result = Call(service, Actor(), Input(Guid.NewGuid()));
                Assert((string)result["status"] == "queued" && service.Writes == 1, "Job was not queued");
                Assert(service.Jobs.Single().GetAttributeValue<string>("cr9cd_requestedby") == User.ToString(), "Client chose another owner");
                Assert(!((JObject)result["request"]).ContainsKey("requestedBy"), "Private caller metadata included in model request");
                Assert((string)result["request"]["today"] == DateTime.UtcNow.ToString("yyyy-MM-dd"), "Client controlled the relative-season clock");
            },
            ["a repeated search ID does not create another job"] = () => {
                var service = new Fake(); var input = Input(Guid.NewGuid());
                Call(service, Actor(), input); Call(service, Actor(), input);
                Assert(service.Writes == 1, "Idempotent start wrote twice");
                ((JObject)input["request"])["query"] = "Another query";
                Denied(() => Call(service, Actor(), input), "already used");
            },
            ["another coordinator cannot read someone else's search"] = () => {
                var service = new Fake(); var input = Input(Guid.NewGuid()); Call(service, Actor(), input);
                input["operation"] = "scheduleSearchGet";
                Denied(() => Call(service, new JObject { ["id"] = Guid.NewGuid().ToString(), ["role"] = "coordinator" }, input), "Search not found");
            },
            ["inactive flow and foreign seasons cannot queue jobs"] = () => {
                var service = new Fake { Enabled = false };
                Denied(() => Call(service, Actor(), Input(Guid.NewGuid())), "not configured");
                service.Enabled = true; service.SeasonScope = "another-app";
                Denied(() => Call(service, Actor(), Input(Guid.NewGuid())), "season from this workspace");
                Assert(service.Writes == 0, "Invalid target created a job");
            },
            ["invalid query, quantity and search IDs fail before writing"] = () => {
                var service = new Fake();
                Denied(() => Call(service, Actor(), Input(Guid.Empty)), "unique search ID");
                Denied(() => Call(service, Actor(), Input(Guid.NewGuid(), "bad\u0001control")), "control characters");
                var input = Input(Guid.NewGuid()); ((JObject)input["request"])["ticketsPerEvent"] = 1001;
                Denied(() => Call(service, Actor(), input), "0 to 1000"); Assert(service.Writes == 0, "Invalid input wrote data");
            },
            ["normal polling and expiration do not update the job or inventory"] = () => {
                var service = new Fake(); var input = Input(Guid.NewGuid()); Call(service, Actor(), input);
                var job = service.Jobs.Single(); input["operation"] = "scheduleSearchGet";
                Assert((string)Call(service, Actor(), input)["status"] == "queued", "Pending status incorrect");
                job["createdon"] = DateTime.UtcNow.AddMinutes(-11);
                Assert((string)Call(service, Actor(), input)["status"] == "failed", "Expired search not reported");
                Assert(service.Writes == 1 && job.GetAttributeValue<string>("cr9cd_status") == "queued", "Polling changed native state");
            },
            ["file preparation can outlast web searches without extending its bounded lifetime"] = () => {
                var service = new Fake(); var input = Input(Guid.NewGuid(), "");
                input["request"]["files"] = new JArray(new JObject { ["name"] = "Tracker.txt", ["mediaType"] = "text/plain", ["size"] = 6, ["data"] = "c2FtcGxl" });
                Call(service, Actor(), input); input["operation"] = "scheduleSearchGet";
                var job = service.Jobs.Single(); job["createdon"] = DateTime.UtcNow.AddMinutes(-11);
                Assert((string)Call(service, Actor(), input)["status"] == "queued", "File analysis expired at the web-only limit");
                job["createdon"] = DateTime.UtcNow.AddHours(-4).AddMinutes(-1);
                Assert((string)Call(service, Actor(), input)["status"] == "failed", "File analysis never expires");
                Assert(service.Writes == 2 && job.GetAttributeValue<string>("cr9cd_status") == "queued", "Polling wrote data");
            },
            ["progress exposes only validated stage counts and times for the owning caller"] = () => {
                var service = new Fake(); var input = Input(Guid.NewGuid()); Call(service, Actor(), input);
                var job = service.Jobs.Single(); input["operation"] = "scheduleSearchGet";
                job["cr9cd_status"] = "searching";
                job["cr9cd_result"] = new JObject { ["progress"] = new JObject { ["stage"] = "researching", ["filesDone"] = 999, ["round"] = 999, ["updatedAt"] = DateTimeOffset.UtcNow.ToString("o"), ["privateContent"] = "must-not-escape" } }.ToString();
                var result = Call(service, Actor(), input);
                Assert((string)result["progress"]["stage"] == "researching" && (int)result["progress"]["filesDone"] == 0 && (int)result["progress"]["round"] == 3, "Unsafe progress values");
                Assert(!result.ToString().Contains("must-not-escape") && result["rawResult"].Type == JTokenType.Null && result["startedAt"].Type == JTokenType.String, "Private response escaped through progress");
                job["cr9cd_result"] = "{\"progress\":{\"stage\":\"not-a-stage\"}}";
                Assert(Call(service, Actor(), input)["progress"].Type == JTokenType.Null, "Unknown stage exposed");
                Assert(service.Writes == 1, "Polling progress wrote data");
            },
            ["plain language and relative seasons do not require an existing season"] = () => {
                var service = new Fake(); var input = Input(Guid.NewGuid(), "I got VGK tickets for next season.\nFind their home schedule.");
                input["request"]["seasonId"] = "";
                var result = Call(service, Actor(), input);
                Assert((string)result["request"]["seasonId"] == "" && result["request"]["from"].Type == JTokenType.Null, "Unrelated season imposed on freeform request");
                Assert(service.Writes == 1, "Freeform request was not queued");
            },
            ["long requests retain their text without overflowing the job title"] = () => {
                var service = new Fake(); var input = Input(Guid.NewGuid(), new String('a', 900));
                var result = Call(service, Actor(), input);
                Assert(((string)result["request"]["query"]).Length == 900 && service.Jobs.Single().GetAttributeValue<string>("cr9cd_name").Length == 300, "Request was lost or title overflowed");
            },
            ["AI destination creation stages a team, season and private games without native writes"] = () => {
                var service = new Fake();
                var state = new JObject { ["teams"] = new JArray(), ["seasons"] = new JArray(), ["games"] = new JArray(), ["seats"] = new JArray() };
                var command = new JObject { ["type"] = "importSchedule", ["seasonId"] = "", ["csv"] = "date,time,title,tickets,kind\n2027-10-10,02:00,Example opponent,2,game",
                    ["newSeason"] = new JObject { ["teamId"] = "", ["teamName"] = "Example team", ["label"] = "2027–28", ["startDate"] = "2027-09-01", ["endDate"] = "2028-06-30", ["defaultTickets"] = 2 } };
                typeof(ReviewApi).GetMethod("Apply", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] { service, state, Actor(), command, DateTimeOffset.UtcNow, null });
                Assert(((JArray)state["teams"]).Count == 1 && ((JArray)state["seasons"]).Count == 1 && ((JArray)state["games"]).Count == 1 && ((JArray)state["seats"]).Count == 2, "Incomplete draft destination");
                Assert((string)state["games"][0]["release"] == "private" && service.Writes == 0, "Planning wrote native data or released inventory");
            },
            ["requesters cannot create an AI import destination"] = () => {
                var service = new Fake(); var state = new JObject();
                try {
                    typeof(ReviewApi).GetMethod("Apply", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] { service, state, Actor("requester"), new JObject { ["type"] = "importSchedule", ["newSeason"] = new JObject() }, DateTimeOffset.UtcNow, null });
                    throw new Exception("Requester imported a destination");
                } catch (TargetInvocationException ex) { Assert(ex.InnerException is InvalidPluginExecutionException && ex.InnerException.Message.Contains("Coordinator"), "Wrong rejection"); }
                Assert(!state.HasValues && service.Writes == 0, "Requester changed state");
            },
            ["the per-user pending search limit rejects another job"] = () => {
                var service = new Fake(); Call(service, Actor(), Input(Guid.NewGuid())); Call(service, Actor(), Input(Guid.NewGuid()));
                Denied(() => Call(service, Actor(), Input(Guid.NewGuid())), "current schedule searches");
                Assert(service.Writes == 2, "Too many pending jobs");
            }
        };
        foreach (var test in tests) { test.Value(); Console.WriteLine("PASS " + test.Key); }
        return tests.Count;
    }
    private sealed class Fake : IOrganizationService
    {
        public bool Enabled = true; public string SeasonScope = "ais-ticket-review-v1"; public int Writes;
        public List<Entity> Jobs = new List<Entity>(); public List<Entity> Notes = new List<Entity>();
        public Entity Retrieve(string name, Guid id, ColumnSet columns)
        {
            Assert(name == "cr9cd_season" && id == Season, "Unexpected native read");
            return new Entity(name, id) { ["cr9cd_review_scope"] = SeasonScope,
                ["cr9cd_review_data"] = new JObject { ["label"] = "2027", ["startDate"] = "2027-01-01", ["endDate"] = "2027-12-31" }.ToString() };
        }
        public EntityCollection RetrieveMultiple(QueryBase query)
        {
            var q = (QueryExpression)query;
            if (q.EntityName == "workflow") return new EntityCollection(Enabled ? new List<Entity> { new Entity("workflow", Guid.NewGuid()) { ["statecode"] = new OptionSetValue(1) } } : new List<Entity>());
            Assert(q.EntityName == "cr9cd_schedulesearch", "Search read the ticket workspace");
            IEnumerable<Entity> rows = Jobs;
            foreach (var condition in q.Criteria.Conditions) {
                var c = condition;
                rows = rows.Where(row => {
                    object value = c.AttributeName == "cr9cd_schedulesearchid" ? (object)row.Id : row.Attributes[c.AttributeName];
                    return c.Operator == ConditionOperator.OnOrAfter ? (DateTime)value >= (DateTime)c.Values[0] : c.Values.Contains(value);
                });
            }
            return new EntityCollection(rows.Take(q.TopCount ?? Int32.MaxValue).ToList());
        }
        public Guid Create(Entity row) {
            if (row.LogicalName == "annotation") { Assert(Jobs.Any(job => job.Id == row.GetAttributeValue<EntityReference>("objectid").Id), "File attached outside its job"); Notes.Add(row); }
            else { Assert(row.LogicalName == "cr9cd_schedulesearch", "Search wrote inventory/workspace state"); row["createdon"] = DateTime.UtcNow; Jobs.Add(row); }
            Writes++; return row.Id;
        }
        public void Update(Entity row) => throw new Exception("Search must not update native inventory or workspace");
        public void Delete(string name, Guid id) => throw new NotSupportedException();
        public OrganizationResponse Execute(OrganizationRequest request) => throw new NotSupportedException();
        public void Associate(string name, Guid id, Relationship relationship, EntityReferenceCollection related) => throw new NotSupportedException();
        public void Disassociate(string name, Guid id, Relationship relationship, EntityReferenceCollection related) => throw new NotSupportedException();
    }
}
