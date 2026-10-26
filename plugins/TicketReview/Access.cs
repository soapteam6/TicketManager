using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Newtonsoft.Json.Linq;

namespace Ais.TicketReview
{
    public sealed partial class ReviewApi
    {
        private static readonly HashSet<string> AdminAccounts = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
            "emikes@ais-now.com", "jjackson@ais-now.com", "aharouff@ais-now.com"
        };
        private static readonly Dictionary<string, string> AppRoleNames = new Dictionary<string, string> {
            { "coordinator", "Ticket Manager Coordinator" }, { "rep", "Ticket Manager Representative" }, { "employee", "Ticket Manager Employee" }
        };
        // Use the authenticated Dataverse login, never the editable contact email or a payload identity.
        private static bool IsAppAdmin(Entity user) => !user.GetAttributeValue<bool>("isdisabled")
            && user.GetAttributeValue<Guid>("applicationid") == Guid.Empty
            && user.GetAttributeValue<Guid>("azureactivedirectoryobjectid") != Guid.Empty
            && user.GetAttributeValue<OptionSetValue>("accessmode")?.Value == 0
            && AdminAccounts.Contains((user.GetAttributeValue<string>("domainname") ?? "").Trim());

        private static Dictionary<string, Entity> AppRoles(IOrganizationService service)
        {
            var roles = Read(service, "role", new ConditionExpression("name", ConditionOperator.In, AppRoleNames.Values.Cast<object>().ToArray()))
                .Where(r => (r.GetAttributeValue<EntityReference>("parentrootroleid")?.Id ?? r.Id) == r.Id).ToList();
            Check(AppRoleNames.Values.All(name => roles.Count(r => r.GetAttributeValue<string>("name") == name) == 1),
                "The Ticket Manager security roles are missing or ambiguous. Contact the environment administrator.");
            return AppRoleNames.ToDictionary(p => p.Key, p => roles.Single(r => r.GetAttributeValue<string>("name") == p.Value));
        }
        private static List<Entity> UserRoles(IOrganizationService service, Guid id, bool inherited)
        {
            var link = inherited
                ? $"<link-entity name='teamroles' from='roleid' to='roleid'><link-entity name='teammembership' from='teamid' to='teamid'><filter><condition attribute='systemuserid' operator='eq' value='{id}'/></filter></link-entity></link-entity>"
                : $"<link-entity name='systemuserroles' from='roleid' to='roleid'><filter><condition attribute='systemuserid' operator='eq' value='{id}'/></filter></link-entity>";
            return FetchRows(service, $"<fetch distinct='true'><entity name='role'><attribute name='roleid'/><attribute name='parentrootroleid'/>{link}</entity></fetch>");
        }
        private static List<Entity> FetchRows(IOrganizationService service, string xml)
        {
            var fetch = XElement.Parse(xml); var rows = new List<Entity>();
            fetch.SetAttributeValue("count", 5000);
            for (var page = 1; ; page++) {
                fetch.SetAttributeValue("page", page);
                var result = service.RetrieveMultiple(new FetchExpression(fetch.ToString(SaveOptions.DisableFormatting)));
                rows.AddRange(result.Entities);
                if (!result.MoreRecords) return rows;
                fetch.SetAttributeValue("paging-cookie", result.PagingCookie);
            }
        }
        private static IEnumerable<string> RoleKeys(IEnumerable<Entity> roles, Dictionary<string, Entity> roots) => roots
            .Where(p => roles.Any(r => (r.GetAttributeValue<EntityReference>("parentrootroleid")?.Id ?? r.Id) == p.Value.Id)).Select(p => p.Key);
        private static string Highest(IEnumerable<string> roles) => new[] { "coordinator", "rep", "employee" }.FirstOrDefault(roles.Contains) ?? "none";

        private static JArray AccessUsers(IOrganizationService service)
        {
            var roots = AppRoles(service);
            // One query for each association type, rather than two queries per directory user.
            var direct = FetchRows(service, "<fetch><entity name='systemuserroles'><attribute name='systemuserid'/><attribute name='roleid'/><order attribute='systemuserid'/><order attribute='roleid'/></entity></fetch>");
            var inherited = FetchRows(service, "<fetch distinct='true'><entity name='teammembership'><attribute name='systemuserid'/><order attribute='systemuserid'/><link-entity name='teamroles' from='teamid' to='teamid' alias='tr'><attribute name='roleid'/><order attribute='roleid'/></link-entity></entity></fetch>");
            var allRoles = Read(service, "role").ToDictionary(r => r.Id);
            Func<Guid, string[]> directKeys = id => RoleKeys(direct.Where(r => r.GetAttributeValue<Guid>("systemuserid") == id).Select(r => allRoles[r.GetAttributeValue<Guid>("roleid")]), roots).OrderBy(k => k).ToArray();
            Func<Guid, string[]> inheritedKeys = id => RoleKeys(inherited.Where(r => r.GetAttributeValue<Guid>("systemuserid") == id).Select(r => allRoles[(Guid)r.GetAttributeValue<AliasedValue>("tr.roleid").Value]), roots).OrderBy(k => k).ToArray();
            return new JArray(Read(service, "systemuser", new ConditionExpression("isdisabled", ConditionOperator.Equal, false), new ConditionExpression("accessmode", ConditionOperator.Equal, 0))
                .Where(u => u.GetAttributeValue<Guid>("azureactivedirectoryobjectid") != Guid.Empty && u.GetAttributeValue<Guid>("applicationid") == Guid.Empty)
                .Select(u => {
                    var assigned = directKeys(u.Id); var team = inheritedKeys(u.Id); var pinned = IsAppAdmin(u);
                    return new JObject { ["id"] = u.Id.ToString(), ["name"] = u.GetAttributeValue<string>("fullname"),
                        ["email"] = u.GetAttributeValue<string>("domainname"), ["isAppAdmin"] = pinned,
                        ["directRoles"] = new JArray(assigned), ["inheritedRoles"] = new JArray(team),
                        ["effectiveRole"] = pinned ? "coordinator" : Highest(assigned.Concat(team)) };
                }));
        }
        private static void SetUserRole(IOrganizationService service, JObject actor, JObject command)
        {
            Check((bool?)actor["isAppAdmin"] == true, "Only an app admin can assign roles.");
            Check(Guid.TryParse(Str(command, "userId"), out var id), "Select a Dataverse user.");
            var target = service.Retrieve("systemuser", id, new ColumnSet("isdisabled", "accessmode", "applicationid", "azureactivedirectoryobjectid", "domainname", "businessunitid"));
            Check(!target.GetAttributeValue<bool>("isdisabled") && target.GetAttributeValue<OptionSetValue>("accessmode")?.Value == 0
                && target.GetAttributeValue<Guid>("applicationid") == Guid.Empty && target.GetAttributeValue<Guid>("azureactivedirectoryobjectid") != Guid.Empty, "Select an active Dataverse user.");
            Check(!IsAppAdmin(target), "App admins have fixed coordinator access. Their access cannot be changed here.");
            ReplaceAppRoles(service, target, UserRoles(service, id, false), Str(command, "role"), command["expectedDirectRoles"] as JArray);
        }
        private static void ReplaceAppRoles(IOrganizationService service, Entity target, List<Entity> existing, string key, JArray expected)
        {
            Check(key == "none" || AppRoleNames.ContainsKey(key), "Select a supported Ticket Manager role.");
            var roots = AppRoles(service);
            var assigned = RoleKeys(existing, roots).OrderBy(k => k).ToArray();
            Check(expected != null && assigned.SequenceEqual(expected.Values<string>().OrderBy(k => k)), "The assigned roles changed. Refresh and review before saving.");
            Entity desired = null;
            if (key != "none") {
                var root = roots[key]; var bu = target.GetAttributeValue<EntityReference>("businessunitid").Id;
                var candidates = Read(service, "role", new ConditionExpression("businessunitid", ConditionOperator.Equal, bu))
                    .Where(r => (r.GetAttributeValue<EntityReference>("parentrootroleid")?.Id ?? r.Id) == root.Id).ToList();
                Check(candidates.Count == 1, "The selected Ticket Manager role is not available in this business unit.");
                desired = candidates[0];
            }
            // Limit SYSTEM elevation to these exact three role families. Preserve every other role and all team memberships.
            var appIds = new HashSet<Guid>(roots.Values.Select(r => r.Id));
            var remove = existing.Where(r => appIds.Contains(r.GetAttributeValue<EntityReference>("parentrootroleid")?.Id ?? r.Id) && r.Id != desired?.Id)
                .Select(r => r.ToEntityReference()).ToList();
            var relationship = new Relationship(target.LogicalName == "team" ? "teamroles_association" : "systemuserroles_association");
            if (remove.Any()) service.Disassociate(target.LogicalName, target.Id, relationship, new EntityReferenceCollection(remove));
            if (desired != null && existing.All(r => r.Id != desired.Id)) service.Associate(target.LogicalName, target.Id,
                relationship, new EntityReferenceCollection(new List<EntityReference> { desired.ToEntityReference() }));
        }
    }
}
