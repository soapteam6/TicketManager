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
        private static readonly string[] DirectoryColumns = { "aaduserid", "accountenabled", "usertype", "displayname", "mail", "userprincipalname", "mobilephone", "businessphones", "companyname" };

        private static string DirectoryText(Entity user, string field) => (user.GetAttributeValue<string>(field) ?? "").Trim();
        private static string DirectoryEmail(Entity user) => String.IsNullOrWhiteSpace(DirectoryText(user, "mail")) ? DirectoryText(user, "userprincipalname") : DirectoryText(user, "mail");
        private static string DirectoryPhone(Entity user) => String.IsNullOrWhiteSpace(DirectoryText(user, "mobilephone")) ? DirectoryText(user, "businessphones") : DirectoryText(user, "mobilephone");

        private static List<Entity> ReadEntraDirectory(IOrganizationService service)
        {
            var query = new QueryExpression("aaduser") {
                ColumnSet = new ColumnSet(DirectoryColumns),
                PageInfo = new PagingInfo { Count = 500, PageNumber = 1 }
            };
            query.Criteria.AddCondition("accountenabled", ConditionOperator.Equal, true);
            query.Criteria.AddCondition("usertype", ConditionOperator.Equal, "Member");
            var users = new List<Entity>();
            var ids = new HashSet<Guid>();
            var cookies = new HashSet<string>();
            while (true) {
                Check(query.PageInfo.PageNumber <= 100, "The Entra directory exceeded the sync limit. No contacts were changed.");
                var page = service.RetrieveMultiple(query);
                foreach (var user in page.Entities) {
                    Check(user.Contains("accountenabled") && user["accountenabled"] is bool && user.Contains("usertype"), "Entra did not return complete account status. No contacts were changed.");
                    // Also enforce eligibility locally if a provider returns an
                    // account outside the requested filter.
                    if (!user.GetAttributeValue<bool>("accountenabled") || !String.Equals(DirectoryText(user, "usertype"), "Member", StringComparison.OrdinalIgnoreCase)) continue;
                    Check(user.Id != Guid.Empty && ids.Add(user.Id), "Entra returned duplicate or invalid identities. No contacts were changed.");
                    Check(DirectoryText(user, "displayname").Length > 0 && DirectoryText(user, "displayname").Length <= 200
                        && DirectoryEmail(user).Length > 0 && DirectoryEmail(user).Length <= 200
                        && DirectoryPhone(user).Length <= 100 && DirectoryText(user, "companyname").Length <= 200,
                        "An Entra profile is incomplete or exceeds the contact field limits. No contacts were changed.");
                    users.Add(user);
                }
                if (!page.MoreRecords) break;
                Check(page.Entities.Count > 0 && !String.IsNullOrEmpty(page.PagingCookie) && cookies.Add(page.PagingCookie),
                    "Entra returned an incomplete directory page. No contacts were changed.");
                query.PageInfo.PageNumber++;
                query.PageInfo.PagingCookie = page.PagingCookie;
            }
            Check(users.Count > 0, "Entra returned no active member accounts. No contacts were changed.");
            return users;
        }

        private static JObject SyncDirectory(IOrganizationService directoryService, JObject state)
        {
            // Read and validate every page before altering the contact collection.
            // A failed directory read must not disable the previously synced staff.
            var users = ReadEntraDirectory(directoryService);
            var employees = Rows(state, "contacts").Where(c => Str(c, "type") == "employee").ToList();
            var existing = new Dictionary<Guid, JObject>();
            foreach (var contact in employees) {
                if (!Guid.TryParse(Str(contact, "directoryId"), out var id)) continue;
                Check(!existing.ContainsKey(id), "Existing employee contacts share an Entra identity. No contacts were changed.");
                existing[id] = contact;
            }
            var active = new HashSet<Guid>(users.Select(u => u.Id));
            var inactive = employees.Count(c => (bool)c["directoryActive"] && (!Guid.TryParse(Str(c, "directoryId"), out var id) || !active.Contains(id)));
            var added = 0;
            foreach (var contact in employees) contact["directoryActive"] = false;
            foreach (var user in users) {
                if (!existing.TryGetValue(user.Id, out var contact)) {
                    contact = new JObject {
                        ["id"] = NewId(), ["type"] = "employee", ["company"] = "AIS", ["tier"] = "bronze",
                        ["appActive"] = true, ["directoryId"] = user.Id.ToString()
                    };
                    Add(state, "contacts", contact); added++;
                }
                contact["name"] = DirectoryText(user, "displayname");
                contact["email"] = DirectoryEmail(user);
                contact["phone"] = DirectoryPhone(user);
                if (!String.IsNullOrEmpty(DirectoryText(user, "companyname"))) contact["company"] = DirectoryText(user, "companyname");
                contact["directoryActive"] = true;
                // IDs, appActive, category and all related history are preserved.
            }
            return new JObject {
                ["source"] = "Microsoft Entra ID", ["activeMembers"] = users.Count,
                ["added"] = added, ["matchedExisting"] = users.Count - added, ["markedInactive"] = inactive
            };
        }
    }
}
