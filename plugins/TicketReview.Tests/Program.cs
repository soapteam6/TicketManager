// Local security tests. This fake implements only directory/role operations and never connects to Dataverse.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Xml.Linq;
using Ais.TicketReview;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Newtonsoft.Json.Linq;

internal static class Program
{
    private static int passed;
    private static object Call(string name, params object[] args)
    {
        try { return typeof(ReviewApi).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, args); }
        catch (TargetInvocationException ex) { throw ex.InnerException; }
    }
    private static void Assert(bool ok, string message) { if (!ok) throw new Exception(message); }
    private static void Test(string name, Action run) { run(); passed++; Console.WriteLine("PASS " + name); }
    private static void Denied(Action action, string message)
    {
        try { action(); } catch (InvalidPluginExecutionException ex) { Assert(ex.Message.Contains(message), ex.Message); return; }
        throw new Exception("Expected rejection: " + message);
    }
    private static JObject Actor(Fake service, Entity user) => (JObject)Call("Actor", service, user.Id);
    private static JObject Command(Entity user, string role, params string[] expected) => new JObject {
        ["userId"] = user.Id.ToString(), ["role"] = role, ["expectedDirectRoles"] = new JArray(expected)
    };
    private static void Main()
    {
        Test("only the three authenticated logins get fixed admin access", () => {
            foreach (var login in new[] { "emikes@ais-now.com", "JJACKSON@AIS-NOW.COM", "aharouff@ais-now.com" }) {
                var s = new Fake(); s.Caller["domainname"] = login;
                var actor = Actor(s, s.Caller);
                Assert((bool)actor["isAppAdmin"] && (string)actor["role"] == "coordinator", "Allowlisted admin missing");
            }
        });
        Test("contact email cannot spoof admin login", () => {
            var s = new Fake(); s.Caller["domainname"] = "other@ais-now.com"; s.Caller["internalemailaddress"] = "emikes@ais-now.com";
            Denied(() => Actor(s, s.Caller), "role is required");
        });
        Test("system administrator role alone does not confer app admin", () => {
            var s = new Fake(); s.Caller["domainname"] = "other@ais-now.com"; s.Assigned[s.Caller.Id].Add(s.SystemRole.Id);
            Denied(() => Actor(s, s.Caller), "role is required");
        });
        Test("ordinary coordinator cannot assign roles", () => {
            var s = new Fake(); s.Caller["domainname"] = "other@ais-now.com"; s.Assigned[s.Caller.Id].Add(s.Roles[0].Id);
            var actor = Actor(s, s.Caller); Assert(!(bool)actor["isAppAdmin"], "Coordinator became admin");
            Denied(() => Call("SetUserRole", s, actor, Command(s.Target, "coordinator")), "Only an app admin");
            Assert(s.Writes == 0, "Unexpected write");
        });
        Test("team coordinator is effective but cannot manage roles", () => {
            var s = new Fake(); s.Caller["domainname"] = "other@ais-now.com"; s.Inherited[s.Caller.Id].Add(s.Roles[0].Id);
            var actor = Actor(s, s.Caller); Assert((string)actor["role"] == "coordinator", "Team role missing");
            Denied(() => Call("SetUserRole", s, actor, Command(s.Target, "employee")), "Only an app admin");
        });
        Test("disabled and application accounts cannot be allowlisted admins", () => {
            var s = new Fake(); s.Caller["isdisabled"] = true;
            Denied(() => Actor(s, s.Caller), "disabled");
            s.Caller["isdisabled"] = false; s.Caller["applicationid"] = Guid.NewGuid();
            Denied(() => Actor(s, s.Caller), "role is required");
        });
        Test("fixed admins cannot be demoted", () => {
            var s = new Fake(); s.Target["domainname"] = "jjackson@ais-now.com";
            Denied(() => Call("SetUserRole", s, Actor(s, s.Caller), Command(s.Target, "none")), "fixed coordinator");
            Assert(s.Writes == 0, "Unexpected write");
        });
        Test("disabled targets are rejected", () => {
            var s = new Fake(); s.Target["isdisabled"] = true;
            Denied(() => Call("SetUserRole", s, Actor(s, s.Caller), Command(s.Target, "rep")), "active Dataverse user");
        });
        Test("arbitrary role names cannot be granted", () => {
            var s = new Fake(); Denied(() => Call("SetUserRole", s, Actor(s, s.Caller), Command(s.Target, "System Administrator")), "supported Ticket Manager");
            Assert(s.Writes == 0, "Unexpected write");
        });
        Test("stale role edits fail before associations change", () => {
            var s = new Fake(); s.Assigned[s.Target.Id].Add(s.Roles[1].Id);
            Denied(() => Call("SetUserRole", s, Actor(s, s.Caller), Command(s.Target, "coordinator")), "roles changed");
            Assert(s.Writes == 0, "Unexpected write");
        });
        Test("role replacement preserves unrelated security roles and team membership", () => {
            var s = new Fake(); s.Assigned[s.Target.Id].AddRange(new[] { s.SystemRole.Id, s.Roles[1].Id }); s.Inherited[s.Target.Id].Add(s.Roles[2].Id);
            Call("SetUserRole", s, Actor(s, s.Caller), Command(s.Target, "coordinator", "rep"));
            Assert(s.Assigned[s.Target.Id].OrderBy(x => x).SequenceEqual(new[] { s.SystemRole.Id, s.Roles[0].Id }.OrderBy(x => x)), "Unrelated roles changed");
            Assert(s.Inherited[s.Target.Id].Single() == s.Roles[2].Id, "Team access changed");
        });
        Test("removing direct access retains inherited access", () => {
            var s = new Fake(); s.Assigned[s.Target.Id].Add(s.Roles[1].Id); s.Inherited[s.Target.Id].Add(s.Roles[2].Id);
            Call("SetUserRole", s, Actor(s, s.Caller), Command(s.Target, "none", "rep"));
            Assert((string)Actor(s, s.Target)["key"] == "employee", "Inherited access removed");
        });
        Test("business unit role copies are resolved by root role identity", () => {
            var s = new Fake(); var childBu = Guid.NewGuid(); s.Target["businessunitid"] = new EntityReference("businessunit", childBu);
            var child = new Entity("role", Guid.NewGuid()) { ["name"] = "Ticket Manager Representative", ["parentrootroleid"] = s.Roles[1].ToEntityReference(), ["businessunitid"] = new EntityReference("businessunit", childBu) };
            s.Roles.Add(child);
            Call("SetUserRole", s, Actor(s, s.Caller), Command(s.Target, "rep"));
            Assert(s.Assigned[s.Target.Id].Single() == child.Id && (string)Actor(s, s.Target)["key"] == "rep", "Wrong business unit role");
        });
        Test("missing business unit role fails before removing existing roles", () => {
            var s = new Fake(); s.Target["businessunitid"] = new EntityReference("businessunit", Guid.NewGuid()); s.Assigned[s.Target.Id].Add(s.Roles[2].Id);
            Denied(() => Call("SetUserRole", s, Actor(s, s.Caller), Command(s.Target, "rep", "employee")), "not available"); Assert(s.Writes == 0, "Roles partially changed");
        });
        Test("unchanged role requests do not rewrite associations", () => {
            var s = new Fake(); s.Assigned[s.Target.Id].Add(s.Roles[1].Id);
            Call("SetUserRole", s, Actor(s, s.Caller), Command(s.Target, "rep", "rep")); Assert(s.Writes == 0, "Unnecessary write");
        });
        Test("FetchXML reads follow all pages", () => {
            var s = new Fake { Paged = true };
            var rows = (List<Entity>)Call("FetchRows", s, "<fetch><entity name='systemuserroles'/></fetch>");
            Assert(rows.Count == 2 && s.PageCalls == 2, "Pagination incomplete");
        });
        Test("ordinary coordinators cannot connect groups or assign group roles", () => {
            var s = new Fake(); var actor = new JObject { ["role"] = "coordinator", ["isAppAdmin"] = false };
            Denied(() => Call("SetGroupRole", s, actor, GroupCommand(s.Group, "rep")), "Only an app admin");
            Denied(() => Call("ConnectGroup", s, actor, new JObject { ["directoryId"] = Guid.NewGuid().ToString(), ["role"] = "rep" }), "Only an app admin");
            Assert(s.Writes == 0, "Unexpected group write");
        });
        Test("group assignment preserves unrelated roles and individual assignments", () => {
            var s = new Fake(); s.Assigned[s.Group.Id].AddRange(new[] { s.SystemRole.Id, s.Roles[2].Id }); s.Assigned[s.Target.Id].Add(s.Roles[2].Id);
            Call("SetGroupRole", s, Actor(s, s.Caller), GroupCommand(s.Group, "rep", "employee"));
            Assert(s.Assigned[s.Group.Id].OrderBy(x => x).SequenceEqual(new[] { s.SystemRole.Id, s.Roles[1].Id }.OrderBy(x => x)), "Wrong team roles");
            Assert(s.Assigned[s.Target.Id].Single() == s.Roles[2].Id, "Individual role changed");
        });
        Test("group edits cannot grant arbitrary security roles", () => {
            var s = new Fake(); Denied(() => Call("SetGroupRole", s, Actor(s, s.Caller), GroupCommand(s.Group, "System Administrator")), "supported Ticket Manager");
            Assert(s.Writes == 0, "Unexpected group write");
        });
        Test("stale group role edits fail before writing", () => {
            var s = new Fake(); s.Assigned[s.Group.Id].Add(s.Roles[2].Id);
            Denied(() => Call("SetGroupRole", s, Actor(s, s.Caller), GroupCommand(s.Group, "rep")), "roles changed"); Assert(s.Writes == 0, "Unexpected group write");
        });
        Test("owner teams and default teams cannot be changed through group access", () => {
            var s = new Fake(); s.Group["teamtype"] = new OptionSetValue(0);
            Denied(() => Call("SetGroupRole", s, Actor(s, s.Caller), GroupCommand(s.Group, "rep")), "group team");
            s.Group["teamtype"] = new OptionSetValue(2); s.Group["isdefault"] = true;
            Denied(() => Call("SetGroupRole", s, Actor(s, s.Caller), GroupCommand(s.Group, "rep")), "group team");
            Assert(s.Writes == 0, "Unexpected group write");
        });
        Test("connecting a group uses its directory identity, members only, and a native team role", () => {
            var s = new Fake(); var directoryId = Guid.NewGuid();
            var id = Guid.Parse((string)Call("ConnectGroup", s, Actor(s, s.Caller), new JObject { ["directoryId"] = directoryId.ToString(), ["role"] = "rep", ["name"] = "Untrusted client name" }));
            var group = s.Groups.Single(g => g.Id == id);
            Assert(group.GetAttributeValue<Guid>("azureactivedirectoryobjectid") == directoryId, "Wrong directory ID");
            Assert(group.GetAttributeValue<OptionSetValue>("membershiptype").Value == 1, "Guest scope enabled");
            Assert(group.GetAttributeValue<string>("name") == "Directory-supplied group name", "Client supplied group name used");
            Assert(s.Assigned[id].Single() == s.Roles[1].Id && s.Assigned[s.Target.Id].Count == 0, "Individual grants were copied");
        });
        Test("duplicate group connections do not overwrite existing role assignments", () => {
            var s = new Fake(); s.Assigned[s.Group.Id].Add(s.Roles[2].Id);
            Denied(() => Call("ConnectGroup", s, Actor(s, s.Caller), new JObject { ["directoryId"] = s.Group.GetAttributeValue<Guid>("azureactivedirectoryobjectid").ToString(), ["role"] = "rep" }), "already linked");
            Assert(s.Writes == 0, "Duplicate connection wrote roles");
        });
        Test("invalid directory IDs and unsupported connect roles fail before creating teams", () => {
            var s = new Fake();
            Denied(() => Call("ConnectGroup", s, Actor(s, s.Caller), new JObject { ["directoryId"] = Guid.Empty.ToString(), ["role"] = "rep" }), "Object ID");
            Denied(() => Call("ConnectGroup", s, Actor(s, s.Caller), new JObject { ["directoryId"] = Guid.NewGuid().ToString(), ["role"] = "System Administrator" }), "supported Ticket Manager");
            Assert(s.Writes == 0, "Unexpected team creation");
        });
        passed += SearchTests.Run();
        Console.WriteLine(passed + " security tests passed; no network access.");
    }
    private static JObject GroupCommand(Entity team, string role, params string[] expected) => new JObject {
        ["groupId"] = team.Id.ToString(), ["role"] = role, ["expectedRoles"] = new JArray(expected)
    };
    private sealed class Fake : IOrganizationService
    {
        public readonly Entity Caller, Target, SystemRole, Group;
        public readonly List<Entity> Roles = new List<Entity>();
        public readonly List<Entity> Groups = new List<Entity>();
        public readonly Dictionary<Guid, List<Guid>> Assigned = new Dictionary<Guid, List<Guid>>(), Inherited = new Dictionary<Guid, List<Guid>>();
        public int Writes, PageCalls; public bool Paged;
        public Fake()
        {
            var bu = Guid.NewGuid(); Caller = User("emikes@ais-now.com", bu); Target = User("tester@ais-now.com", bu);
            foreach (var name in new[] { "Ticket Manager Coordinator", "Ticket Manager Representative", "Ticket Manager Employee", "System Administrator" }) {
                var role = new Entity("role", Guid.NewGuid()) { ["name"] = name, ["businessunitid"] = new EntityReference("businessunit", bu) }; role["parentrootroleid"] = role.ToEntityReference(); Roles.Add(role);
            }
            SystemRole = Roles.Last();
            Group = new Entity("team", Guid.NewGuid()) { ["name"] = "Test sales group", ["teamtype"] = new OptionSetValue(2), ["azureactivedirectoryobjectid"] = Guid.NewGuid(), ["membershiptype"] = new OptionSetValue(1), ["businessunitid"] = new EntityReference("businessunit", bu) };
            Groups.Add(Group);
            foreach (var user in new[] { Caller, Target, Group }) { Assigned[user.Id] = new List<Guid>(); Inherited[user.Id] = new List<Guid>(); }
        }
        private static Entity User(string login, Guid bu) => new Entity("systemuser", Guid.NewGuid()) {
            ["domainname"] = login, ["fullname"] = "Test User", ["internalemailaddress"] = login, ["accessmode"] = new OptionSetValue(0),
            ["isdisabled"] = false, ["azureactivedirectoryobjectid"] = Guid.NewGuid(), ["businessunitid"] = new EntityReference("businessunit", bu)
        };
        public Entity Retrieve(string name, Guid id, ColumnSet columns) => (name == "team" ? Groups : new List<Entity> { Caller, Target }).Single(u => u.Id == id);
        public EntityCollection RetrieveMultiple(QueryBase query)
        {
            if (query is QueryExpression q) {
                IEnumerable<Entity> rows = q.EntityName == "team" ? Groups : Roles;
                foreach (var c in q.Criteria.Conditions) {
                    rows = rows.Where(r => {
                        var value = r.Attributes[c.AttributeName];
                        if (value is EntityReference reference) value = reference.Id;
                        if (value is OptionSetValue choice) value = choice.Value;
                        return c.Values.Contains(value);
                    });
                }
                return new EntityCollection(rows.ToList());
            }
            var fetch = XElement.Parse(((FetchExpression)query).Query);
            if (Paged) {
                PageCalls++; var page = (int?)fetch.Attribute("page") ?? 1;
                if (page == 2) Assert((string)fetch.Attribute("paging-cookie") == "<cookie page='1'/>", "Cookie not preserved");
                return new EntityCollection(new List<Entity> { new Entity("systemuserroles", Guid.NewGuid()) }) { MoreRecords = page == 1, PagingCookie = "<cookie page='1'/>" };
            }
            var id = Guid.Parse((string)fetch.Descendants("condition").Single().Attribute("value"));
            var condition = fetch.Descendants("condition").Single();
            var ids = (string)condition.Attribute("attribute") == "teamid" ? Assigned[id] : fetch.Descendants("link-entity").Any(e => (string)e.Attribute("name") == "teamroles") ? Inherited[id] : Assigned[id];
            return new EntityCollection(Roles.Where(r => ids.Contains(r.Id)).ToList());
        }
        public void Associate(string name, Guid id, Relationship relationship, EntityReferenceCollection related) { Assert(relationship.SchemaName == (name == "team" ? "teamroles_association" : "systemuserroles_association"), "Wrong association"); Writes++; Assigned[id].AddRange(related.Select(r => r.Id)); }
        public void Disassociate(string name, Guid id, Relationship relationship, EntityReferenceCollection related) { Assert(relationship.SchemaName == (name == "team" ? "teamroles_association" : "systemuserroles_association"), "Wrong association"); Writes++; Assigned[id].RemoveAll(r => related.Any(e => e.Id == r)); }
        public Guid Create(Entity entity) {
            Assert(entity.LogicalName == "team" && !entity.Contains("name") && !entity.Contains("teamtype"), "Group identity must be supplied by Dataverse");
            var team = new Entity("team", Guid.NewGuid());
            foreach (var attribute in entity.Attributes) team[attribute.Key] = attribute.Value;
            team["name"] = "Directory-supplied group name"; team["teamtype"] = new OptionSetValue(2); Groups.Add(team);
            Assigned[team.Id] = new List<Guid>(); Inherited[team.Id] = new List<Guid>(); Writes++; return team.Id;
        }
        public void Update(Entity entity) => throw new NotSupportedException();
        public void Delete(string name, Guid id) => throw new NotSupportedException();
        public OrganizationResponse Execute(OrganizationRequest request) => throw new NotSupportedException();
    }
}
