using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.Xrm.Sdk;
using Newtonsoft.Json.Linq;

namespace Ais.TicketReview
{
    public sealed partial class ReviewApi
    {
        private static JArray ImportFileMetadata(JObject request, JObject original)
        {
            var files = request["files"] as JArray ?? new JArray();
            Check(files.Count <= 5, "Choose up to 5 files.");
            var result = new JArray(); var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase); long total = 0;
            foreach (var file in files.Cast<JObject>()) {
                var name = Text(file, "name", 160); var mediaType = Str(file, "mediaType"); var encoded = Str(file, "data");
                Check(!Regex.IsMatch(name, "[\\\\/\"\\x00-\\x1f]") && names.Add(name), "Use distinct file names without folders, quotes or control characters.");
                Check(Regex.IsMatch(mediaType, @"^[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+$") && mediaType.Length <= 150, "Choose a valid file type.");
                Check(encoded.Length > 0 && encoded.Length <= 5592408 && Regex.IsMatch(encoded, @"^[A-Za-z0-9+/]*={0,2}$"), "The uploaded file is empty, invalid or too large.");
                byte[] bytes; try { bytes = Convert.FromBase64String(encoded); } catch (FormatException) { throw new InvalidPluginExecutionException("The uploaded file could not be read. Choose it again."); }
                total += bytes.Length; Check(bytes.Length > 0 && total <= 4 * 1024 * 1024, "Choose files totalling 4 MB or less.");
                Check((long?)file["size"] == bytes.Length, "The uploaded file size does not match its contents.");
                string hash; using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                var prior = (original?["files"] as JArray)?.OfType<JObject>().FirstOrDefault(x => Str(x, "name") == name);
                result.Add(new JObject { ["name"] = name, ["mediaType"] = mediaType, ["size"] = bytes.Length, ["sha256"] = hash,
                    ["annotationId"] = prior?["annotationId"] ?? (JToken)Guid.NewGuid().ToString() });
            }
            return result;
        }

        private static void SaveImportFiles(IOrganizationService service, Guid jobId, JObject request, JArray files)
        {
            var uploads = (request["files"] as JArray ?? new JArray()).OfType<JObject>().ToDictionary(f => Str(f, "name").Trim());
            foreach (var file in files.OfType<JObject>()) service.Create(new Entity("annotation", Guid.Parse(Str(file, "annotationId"))) {
                ["subject"] = "AI Import: " + Str(file, "name"), ["filename"] = Str(file, "name"), ["mimetype"] = Str(file, "mediaType"),
                ["isdocument"] = true, ["documentbody"] = Str(uploads[Str(file, "name")], "data"), ["objectid"] = new EntityReference(SearchTable, jobId)
            });
        }
    }
}
