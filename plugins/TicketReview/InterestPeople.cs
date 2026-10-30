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
        private const string CrmOrganization = "https://org83e945f6.crm.dynamics.com";

        private static JObject InterestRequester(IOrganizationService service, JObject s, JObject actor, JObject c)
        {
            var contactId = Str(c, "onBehalfContactId"); var legacyId = Str(c, "onBehalfOf");
            Check(IsAdmin(actor) || String.IsNullOrEmpty(contactId) && String.IsNullOrEmpty(legacyId), "Only coordinators enter interest on behalf.");
            Check(String.IsNullOrEmpty(contactId) || String.IsNullOrEmpty(legacyId), "Choose one requesting person.");
            if (!String.IsNullOrEmpty(contactId)) {
                var contact = Find(s, "contacts", contactId);
                Check(Str(contact, "type") == "employee" && Eligible(contact), "Choose an active employee requesting person.");
                Check(Guid.TryParse(Str(contact, "directoryId"), out var directoryId) && directoryId != Guid.Empty, "Requesting person needs an Entra identity.");
                return new JObject { ["id"] = contact["id"], ["directoryId"] = directoryId.ToString(), ["contactId"] = contact["id"], ["name"] = contact["name"], ["email"] = contact["email"] };
            }
            var id = String.IsNullOrEmpty(legacyId) ? Str(actor, "id") : legacyId;
            Check(Guid.TryParse(id, out var userId), "Choose a requesting person.");
            var user = service.Retrieve("systemuser", userId, new ColumnSet("isdisabled", "applicationid", "accessmode", "azureactivedirectoryobjectid", "fullname", "internalemailaddress"));
            var directory = user.GetAttributeValue<Guid>("azureactivedirectoryobjectid");
            Check(!user.GetAttributeValue<bool>("isdisabled") && user.GetAttributeValue<Guid>("applicationid") == Guid.Empty && directory != Guid.Empty, "Requesting user is disabled or unavailable.");
            var employee = Rows(s, "contacts").FirstOrDefault(x => Str(x, "type") == "employee" && String.Equals(Str(x, "directoryId"), directory.ToString(), StringComparison.OrdinalIgnoreCase));
            Check(employee == null || Eligible(employee), "Requesting person is inactive.");
            return new JObject { ["id"] = id, ["directoryId"] = directory.ToString(), ["contactId"] = employee?["id"], ["name"] = user.GetAttributeValue<string>("fullname"), ["email"] = user.GetAttributeValue<string>("internalemailaddress") };
        }

        private static bool OwnInterest(JObject request, JObject actor)
        {
            return Str(request, "requesterId") == Str(actor, "id") ||
                !String.IsNullOrEmpty(Str(actor, "directoryId")) && String.Equals(Str(request, "requesterDirectoryId"), Str(actor, "directoryId"), StringComparison.OrdinalIgnoreCase);
        }

        // CRM is read through the caller's existing connector. This command copies
        // selected customer details into the SAME local transaction as the request.
        // Cross-environment IDs are references only, never local lookups or authority.
        private static List<JObject> InterestCrmContacts(JObject s, JObject c)
        {
            var incoming = c["crmContacts"] as JArray;
            if (incoming == null || incoming.Count == 0) return new List<JObject>();
            Check(Str(c, "purpose") == "customer" && !((JArray)c["contactIds"]).Any(), "Choose CRM contacts or saved customer contacts.");
            Check(incoming.Count <= Number(c, "quantity", 1, 100), "Request at least one ticket per selected contact.");
            var prepared = new List<JObject>(); var seen = new HashSet<string>(); string account = null;
            foreach (var entry in incoming.Cast<JObject>()) {
                Check(Guid.TryParse(Str(entry, "contactId"), out var contactId) && contactId != Guid.Empty && Guid.TryParse(Str(entry, "accountId"), out var accountId) && accountId != Guid.Empty, "Choose a valid CRM contact and business.");
                var accountKey = Guid.Parse(Str(entry, "accountId")).ToString(); var contactKey = contactId.ToString();
                Check(account == null || account == accountKey, "Choose CRM contacts from one business."); account = accountKey;
                Check(seen.Add(contactKey), "Select each CRM contact once.");
                var name = Text(entry, "name", 200); var company = Text(entry, "accountName", 200);
                Check(Str(entry, "email").Length <= 320 && Str(entry, "phone").Length <= 100, "CRM contact details are too long.");
                var existing = Rows(s, "contacts").FirstOrDefault(x => Str(x, "crmOrganization") == CrmOrganization && Str(x, "crmContactId") == contactKey);
                Check(existing == null || Str(existing, "type") == "customer" && Eligible(existing) && Str(existing, "crmAccountId") == accountKey, "The saved CRM contact is inactive or belongs to a different business. Review Contacts & history.");
                // Do not overwrite coordinator-edited contact details or value tiers.
                prepared.Add(existing ?? new JObject { ["id"] = NewId(), ["type"] = "customer", ["name"] = name, ["company"] = company,
                    ["email"] = Str(entry, "email").Trim(), ["phone"] = Str(entry, "phone").Trim(), ["tier"] = "prospect", ["appActive"] = true, ["directoryActive"] = true, ["directoryId"] = JValue.CreateNull(),
                    ["crmOrganization"] = CrmOrganization, ["crmContactId"] = contactKey, ["crmAccountId"] = accountKey });
            }
            foreach (var row in prepared.Where(row => !Rows(s, "contacts").Any(x => Str(x, "id") == Str(row, "id")))) Add(s, "contacts", row);
            return prepared;
        }
    }
}
