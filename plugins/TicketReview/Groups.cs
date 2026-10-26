using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using Newtonsoft.Json.Linq;

namespace Ais.TicketReview
{
    public sealed partial class ReviewApi
    {
        private static readonly ColumnSet GroupColumns = new ColumnSet("name", "teamtype", "azureactivedirectoryobjectid", "membershiptype", "businessunitid", "isdefault");
        private static void RequireAppAdmin(JObject actor) => Check((bool?)actor["isAppAdmin"] == true, "Only an app admin can assign group roles.");
        private static bool IsGroup(Entity team) => !team.GetAttributeValue<bool>("isdefault")
            && new[] { 2, 3 }.Contains(team.GetAttributeValue<OptionSetValue>("teamtype")?.Value ?? -1)
            && team.GetAttributeValue<Guid>("azureactivedirectoryobjectid") != Guid.Empty;
        private static List<Entity> TeamRoles(IOrganizationService service, Guid id) => FetchRows(service,
            $"<fetch distinct='true'><entity name='role'><attribute name='roleid'/><attribute name='parentrootroleid'/><link-entity name='teamroles' from='roleid' to='roleid'><filter><condition attribute='teamid' operator='eq' value='{id}'/></filter></link-entity></entity></fetch>");
        private static JArray AccessGroups(IOrganizationService service)
        {
            var roots = AppRoles(service);
            var roles = Read(service, "role").ToDictionary(r => r.Id);
            var associations = FetchRows(service, "<fetch><entity name='teamroles'><attribute name='teamid'/><attribute name='roleid'/><order attribute='teamid'/><order attribute='roleid'/></entity></fetch>");
            return new JArray(Read(service, "team", new ConditionExpression("teamtype", ConditionOperator.In, 2, 3))
                .Where(IsGroup).Select(team => new JObject {
                    ["id"] = team.Id.ToString(), ["directoryId"] = team.GetAttributeValue<Guid>("azureactivedirectoryobjectid").ToString(),
                    ["name"] = team.GetAttributeValue<string>("name"), ["type"] = team.GetAttributeValue<OptionSetValue>("teamtype").Value == 2 ? "security" : "microsoft365",
                    ["membership"] = new[] { "membersAndGuests", "members", "owners", "guests" }[team.GetAttributeValue<OptionSetValue>("membershiptype")?.Value ?? 0],
                    ["roles"] = new JArray(RoleKeys(associations.Where(a => a.GetAttributeValue<Guid>("teamid") == team.Id).Select(a => roles[a.GetAttributeValue<Guid>("roleid")]), roots).OrderBy(k => k))
                }));
        }
        private static void SetGroupRole(IOrganizationService service, JObject actor, JObject command)
        {
            RequireAppAdmin(actor);
            Check(Guid.TryParse(Str(command, "groupId"), out var id), "Select a linked group.");
            var team = service.Retrieve("team", id, GroupColumns);
            Check(IsGroup(team), "Select a Microsoft Entra security or Microsoft 365 group team.");
            ReplaceAppRoles(service, team, TeamRoles(service, id), Str(command, "role"), command["expectedRoles"] as JArray);
        }
        private static string ConnectGroup(IOrganizationService service, JObject actor, JObject command)
        {
            RequireAppAdmin(actor);
            Check(Guid.TryParse(Str(command, "directoryId"), out var directoryId) && directoryId != Guid.Empty, "Enter the Microsoft Entra group's Object ID.");
            var key = Str(command, "role");
            Check(AppRoleNames.ContainsKey(key), "Select a supported Ticket Manager role.");
            // Members only. Do not silently grant the app to guests or owners outside this membership scope.
            const int members = 1;
            Check(!Read(service, "team", new ConditionExpression("azureactivedirectoryobjectid", ConditionOperator.Equal, directoryId),
                new ConditionExpression("membershiptype", ConditionOperator.Equal, members)).Any(), "This group is already linked for members. Select it from Groups to change its role.");
            var roots = AppRoles(service);
            // Dataverse validates the existing directory group and supplies its real name/type.
            // This creates a Dataverse group team; it never creates or changes an Entra group.
            var id = service.Create(new Entity("team") {
                ["azureactivedirectoryobjectid"] = directoryId, ["membershiptype"] = new OptionSetValue(members),
                ["businessunitid"] = roots[key].GetAttributeValue<EntityReference>("businessunitid")
            });
            var target = service.Retrieve("team", id, GroupColumns);
            Check(IsGroup(target), "Dataverse could not link a supported Microsoft Entra group.");
            Check(String.IsNullOrEmpty(Str(command, "expectedName")) || String.Equals(Str(command, "expectedName"), target.GetAttributeValue<string>("name"), StringComparison.OrdinalIgnoreCase),
                "The directory group name does not match the expected group. No group role was assigned.");
            ReplaceAppRoles(service, target, TeamRoles(service, id), key, new JArray());
            return id.ToString();
        }
    }
}
