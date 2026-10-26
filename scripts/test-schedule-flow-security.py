"""Offline checks of secret boundaries in each supported Claude credential mode."""
import json
import unittest

from schedule_search_flow import definition, KEY_SCHEMA


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
            call = work["Research"]["actions"]["Claude_messages"]
            for action in [work["Get_Claude_key"], call]:
                self.assertEqual(set(action["runtimeConfiguration"]["secureData"]["properties"]), {"inputs", "outputs"})
            self.assertEqual(call["type"], "Http")
            self.assertEqual(call["inputs"]["uri"], "https://api.anthropic.com/v1/messages")
            self.assertTrue(call["inputs"]["headers"]["x-api-key"].startswith("@"))
            self.assertEqual(work["Research"]["runAfter"], {"Get_Claude_key": ["Succeeded"]})

    def test_key_is_not_added_to_messages_or_result_storage(self):
        work = self.build("textEnvironmentVariable")["actions"]["Find_schedule"]["actions"]
        loop = work["Research"]["actions"]
        for name in ["Collect_blocks", "Continue_message", "Set_stop_reason"]:
            self.assertNotIn("Get_Claude_key", json.dumps(loop[name]))
        self.assertNotIn("Get_Claude_key", json.dumps(work["Check_completed"]))
        self.assertNotIn("sk-ant-", json.dumps(self.build("textEnvironmentVariable")))

    def test_secret_mode_uses_the_supported_dataverse_secret_action(self):
        key = self.build("secretEnvironmentVariable")["actions"]["Find_schedule"]["actions"]["Get_Claude_key"]
        self.assertEqual(key["inputs"]["parameters"], {"actionName": "RetrieveEnvironmentVariableSecretValue", "item/EnvironmentVariableName": KEY_SCHEMA})

    def test_text_mode_reads_only_its_solution_variable(self):
        key = self.build("textEnvironmentVariable")["actions"]["Find_schedule"]["actions"]["Get_Claude_key"]
        self.assertEqual(key["inputs"]["parameters"]["$filter"], f"schemaname eq '{KEY_SCHEMA}'")
        self.assertEqual(key["inputs"]["parameters"]["$top"], 1)

    def test_unknown_credential_source_cannot_silently_fall_back(self):
        with self.assertRaises(ValueError):
            self.build("typo")


if __name__ == "__main__":
    unittest.main()
