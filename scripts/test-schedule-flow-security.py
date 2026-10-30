"""Offline checks of secret boundaries in each supported Claude credential mode."""
import json
import unittest

from schedule_search_flow import definition, KEY_SCHEMA, assert_protected_actions, walk_actions


class FlowSecretTests(unittest.TestCase):
    def build(self, mode):
        return definition("cr9cd_schedulesearchs", "/providers/Microsoft.PowerApps/apis/test_claude", mode)

    def test_existing_connection_mode_is_still_masked(self):
        work = self.build("connection")["actions"]["Find_schedule"]["actions"]
        call = work["Research"]["actions"]["Claude_messages"]
        self.assertEqual(set(call["runtimeConfiguration"]["secureData"]["properties"]), {"inputs", "outputs"})
        self.assertNotIn("Get_Claude_key", work)

    def test_both_environment_modes_mask_key_read_and_http_request(self):
        for mode in ["secretEnvironmentVariable", "textEnvironmentVariable"]:
            work = self.build(mode)["actions"]["Find_schedule"]["actions"]
            call = work["Choose_import_path"]["else"]["actions"]["Research"]["actions"]["Claude_messages"]
            for action in [work["Get_Claude_key"], call]:
                self.assertEqual(set(action["runtimeConfiguration"]["secureData"]["properties"]), {"inputs", "outputs"})
            self.assertEqual(call["type"], "Http")
            self.assertEqual(call["inputs"]["uri"], "https://api.anthropic.com/v1/messages")
            self.assertTrue(call["inputs"]["headers"]["x-api-key"].startswith("@"))
            self.assertEqual(work["Upload_files"]["runAfter"], {"Get_Claude_key": ["Succeeded"]})
            self.assertEqual(work["Choose_import_path"]["runAfter"], {"Upload_files": ["Succeeded"]})

    def test_key_is_not_added_to_messages_or_result_storage(self):
        work = self.build("textEnvironmentVariable")["actions"]["Find_schedule"]["actions"]
        public = work["Choose_import_path"]["else"]["actions"]
        loop = public["Research"]["actions"]
        for name in ["Collect_blocks", "Continue_message", "Set_stop_reason"]:
            self.assertNotIn("Get_Claude_key", json.dumps(loop[name]))
        self.assertNotIn("Get_Claude_key", json.dumps(public["Check_completed"]))
        self.assertNotIn("sk-ant-", json.dumps(self.build("textEnvironmentVariable")))

    def test_secret_mode_uses_the_supported_dataverse_secret_action(self):
        key = self.build("secretEnvironmentVariable")["actions"]["Find_schedule"]["actions"]["Get_Claude_key"]
        self.assertEqual(key["inputs"]["parameters"], {"actionName": "RetrieveEnvironmentVariableSecretValue", "item/EnvironmentVariableName": KEY_SCHEMA})

    def test_text_mode_reads_only_its_solution_variable(self):
        key = self.build("textEnvironmentVariable")["actions"]["Find_schedule"]["actions"]["Get_Claude_key"]
        self.assertEqual(key["inputs"]["parameters"]["$filter"], f"schemaname eq '{KEY_SCHEMA}'")
        self.assertEqual(key["inputs"]["parameters"]["$top"], 1)

    def test_private_file_path_does_not_store_prompts_or_model_responses_in_variables(self):
        flow = self.build("textEnvironmentVariable")
        work = flow["actions"]["Find_schedule"]["actions"]
        private = work["Choose_import_path"]["actions"]
        def walk(actions):
            for action in actions.values():
                yield action
                yield from walk(action.get("actions", {}))
                yield from walk(action.get("else", {}).get("actions", {}))
        for action in walk(private):
            if action["type"] == "AppendToArrayVariable":
                self.assertEqual(action["inputs"]["name"], "batchIds")
                self.assertRegex(action["inputs"]["value"], r"^@body\('Submit_private_[123]'\)\?\['id'\]$")
            else:
                self.assertNotIn(action["type"], ["SetVariable", "InitializeVariable"])
            if action["type"] in ["Http", "OpenApiConnection", "Compose"]:
                if "runtimeConfiguration" in action:
                    self.assertEqual(set(action["runtimeConfiguration"]["secureData"]["properties"]), {"inputs", "outputs"})
                else:
                    # Only a constant failure status may be unmasked. No private
                    # prompt, file contents, response, source notes or key enters it.
                    params = action["inputs"]["parameters"]
                    self.assertEqual(params["item/cr9cd_status"], "failed")
                    self.assertFalse(params["item/cr9cd_error"].startswith("@"))
                    self.assertEqual(set(params), {"entityName", "recordId", "item/cr9cd_status", "item/cr9cd_error"})
        self.assertEqual(flow["actions"]["User_content"]["inputs"]["variables"][0]["value"], [])
        init = flow["actions"]["Messages"]["inputs"]["variables"][0]["value"]
        self.assertTrue(init.startswith("@if(empty("))
        self.assertTrue(init.endswith(", json('[]'))"))

    def test_upload_variables_contain_only_opaque_references(self):
        work = self.build("textEnvironmentVariable")["actions"]["Find_schedule"]["actions"]
        upload = work["Upload_files"]
        self.assertTrue(upload["foreach"].startswith("@range("))
        actions = upload["actions"]
        for name in ["Read_upload", "Claude_upload"]:
            self.assertEqual(set(actions[name]["runtimeConfiguration"]["secureData"]["properties"]), {"inputs", "outputs"})
        for name in ["Remember_upload", "Attach_upload"]:
            value = actions[name]["inputs"]["value"]
            for forbidden in ["documentbody", "filename", "['query']", "Private_Claude", "x-api-key"]:
                self.assertNotIn(forbidden, value)
        self.assertIn("'annotationId'", actions["Remember_upload"]["inputs"]["value"])
        self.assertIn("'fileId'", actions["Remember_upload"]["inputs"]["value"])

    def test_cleanup_deletes_only_files_uploaded_by_this_job(self):
        flow = self.build("textEnvironmentVariable")
        cleanup = flow["actions"]["Delete_Claude_uploads"]
        self.assertEqual(cleanup["foreach"], "@variables('uploadedFiles')")
        call = cleanup["actions"]["Delete_Claude_file"]
        self.assertEqual(call["inputs"]["method"], "DELETE")
        self.assertIn("items('Delete_Claude_uploads')?['fileId']", call["inputs"]["uri"])
        self.assertEqual(set(call["runtimeConfiguration"]["secureData"]["properties"]), {"inputs", "outputs"})

    def test_file_analysis_is_polled_without_a_long_synchronous_request(self):
        flow = self.build("textEnvironmentVariable")
        branch = flow["actions"]["Find_schedule"]["actions"]["Choose_import_path"]["actions"]
        first = branch["Private_round_1"]["actions"]
        self.assertEqual(first["Submit_private_1"]["inputs"]["uri"], "https://api.anthropic.com/v1/messages/batches")
        self.assertEqual(len(first["Submit_private_1"]["inputs"]["body"]["requests"]), 1)
        self.assertEqual(first["Await_private_1"]["limit"], {"count": 120, "timeout": "PT1H"})
        self.assertEqual(first["Await_private_1"]["operationOptions"], "FailWhenLimitsReached")
        self.assertEqual(first["Private_Claude_1"]["type"], "Http")
        self.assertIn("/results", first["Private_Claude_1"]["inputs"]["uri"])
        self.assertEqual(flow["triggers"]["When_search_is_requested"]["runtimeConfiguration"]["secureData"]["properties"], ["outputs"])
        self.assertEqual(flow["actions"]["Cleanup_private_batches"]["foreach"], "@variables('batchIds')")
        self.assertIn("Cleanup_private_batches", flow["actions"]["Delete_Claude_uploads"]["runAfter"])

    def test_file_blocks_and_result_blocks_remain_arrays_in_workflow_expressions(self):
        work = self.build("textEnvironmentVariable")["actions"]["Find_schedule"]["actions"]
        branch = work["Choose_import_path"]["actions"]
        messages = branch["Private_round_1"]["actions"]["Submit_private_1"]["inputs"]["body"]["requests"][0]["params"]["messages"]
        self.assertIn("'content', union(createArray(", messages)
        self.assertNotIn("'content', concat(", messages)
        result = branch["Check_private_complete"]["actions"]["Save_private_result"]["inputs"]["parameters"]["item/cr9cd_result"]
        self.assertIn("'content', union(", result)
        self.assertNotIn("'content', concat(", result)

    def test_export_validation_covers_nested_private_calls_and_cleanup(self):
        for mode in ["textEnvironmentVariable", "secretEnvironmentVariable"]:
            assert_protected_actions(self.build(mode))
        flow = self.build("textEnvironmentVariable")
        flow["actions"]["Cleanup_private_batches"]["actions"]["Cleanup_batch_status"].pop("runtimeConfiguration")
        with self.assertRaisesRegex(RuntimeError, "Cleanup_batch_status"):
            assert_protected_actions(flow)

    def test_progress_reports_only_masked_stage_counts_and_times(self):
        flow = self.build("textEnvironmentVariable")
        reports = [(name, action) for name, action in walk_actions(flow) if name.startswith("Report_")]
        self.assertGreater(len(reports), 8)
        for name, action in reports:
            self.assertEqual(set(action["runtimeConfiguration"]["secureData"]["properties"]), {"inputs", "outputs"}, name)
            params = action["inputs"]["parameters"]
            self.assertEqual(set(params), {"entityName", "recordId", "item/cr9cd_result"})
            value = params["item/cr9cd_result"]
            for private in ["Get_Claude_key", "documentbody", "filename", "Private_Claude", "['query']"]:
                self.assertNotIn(private, value)
            for field in ["'stage'", "'filesDone'", "'totalFiles'", "'round'", "'updatedAt'"]:
                self.assertIn(field, value)

    def test_unknown_credential_source_cannot_silently_fall_back(self):
        with self.assertRaises(ValueError):
            self.build("typo")


if __name__ == "__main__":
    unittest.main()
