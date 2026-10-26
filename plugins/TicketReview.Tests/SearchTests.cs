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
            ["requestedBy"] = Guid.NewGuid().ToString()
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
            ["search creation writes only a job owned by the authenticated caller"] = () => {
                var service = new Fake(); var result = Call(service, Actor(), Input(Guid.NewGuid()));
                Assert((string)result["status"] == "queued" && service.Writes == 1, "Job was not queued");
                Assert(service.Jobs.Single().GetAttributeValue<string>("cr9cd_requestedby") == User.ToString(), "Client chose another owner");
                Assert(!((JObject)result["request"]).ContainsKey("requestedBy"), "Private caller metadata included in model request");
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
                Denied(() => Call(service, Actor(), Input(Guid.NewGuid(), "two\nlines")), "single line");
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
        public List<Entity> Jobs = new List<Entity>();
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
        public Guid Create(Entity row) { Assert(row.LogicalName == "cr9cd_schedulesearch", "Search wrote inventory/workspace state"); row["createdon"] = DateTime.UtcNow; Jobs.Add(row); Writes++; return row.Id; }
        public void Update(Entity row) => throw new Exception("Search must not update native inventory or workspace");
        public void Delete(string name, Guid id) => throw new NotSupportedException();
        public OrganizationResponse Execute(OrganizationRequest request) => throw new NotSupportedException();
        public void Associate(string name, Guid id, Relationship relationship, EntityReferenceCollection related) => throw new NotSupportedException();
        public void Disassociate(string name, Guid id, Relationship relationship, EntityReferenceCollection related) => throw new NotSupportedException();
    }
}
