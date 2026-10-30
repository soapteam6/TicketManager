"""Credential-free definition builder for the background Claude schedule search."""
from pathlib import Path
from copy import deepcopy

ROOT = Path(__file__).resolve().parent.parent
FLOW_ID = "c5df18a1-df8f-4f17-bac4-e04d99d6be79"
FLOW_NAME = "Ticket Manager - AI Import"
FLOW_UNIQUE_NAME = "cr9cd_TicketScheduleSearch"
TABLE = "cr9cd_schedulesearch"
MODEL = "claude-sonnet-4-6"
KEY_SCHEMA = "cr9cd_TicketManagerAnthropicApiKey"


def definition(entity_set, connector_api="", credential_mode="textEnvironmentVariable"):
    if credential_mode not in ["connection", "secretEnvironmentVariable", "textEnvironmentVariable"]:
        raise ValueError("Unsupported Claude credential source.")
    dv = {"apiId": "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps", "connectionName": "dataverse", "operationId": "UpdateOnlyRecord"}

    def update(fields, after=None):
        return {"type": "OpenApiConnection", "runAfter": after or {}, "inputs": {"host": dv,
                "parameters": {"entityName": entity_set, "recordId": "@triggerBody()?['cr9cd_schedulesearchid']", **{"item/" + k: v for k, v in fields.items()}}}}

    def initialize(name, kind, value, after=None):
        return {"type": "InitializeVariable", "runAfter": after or {}, "inputs": {"variables": [{"name": name, "type": kind, "value": value}]}}

    prompt = "@string(setProperty(setProperty(setProperty(setProperty(json('{}'), 'query', json(triggerBody()?['cr9cd_input'])?['query']), 'from', json(triggerBody()?['cr9cd_input'])?['from']), 'through', json(triggerBody()?['cr9cd_input'])?['through']), 'homeOnly', json(triggerBody()?['cr9cd_input'])?['homeOnly']))"
    prompt = "@string(setProperty(" + prompt[len("@string("):-1] + ", 'today', coalesce(json(triggerBody()?['cr9cd_input'])?['today'], formatDateTime(utcNow(), 'yyyy-MM-dd'))))"
    prompt = "@string(setProperty(setProperty(" + prompt[len("@string("):-1] + ", 'files', coalesce(json(triggerBody()?['cr9cd_input'])?['files'], json('[]'))), 'timeZone', coalesce(json(triggerBody()?['cr9cd_input'])?['timeZone'], 'America/Los_Angeles')))"
    actions = {
        "Messages": initialize("messages", "array", "@if(empty(coalesce(json(triggerBody()?['cr9cd_input'])?['files'], json('[]'))), createArray(setProperty(json('{\"role\":\"user\"}'), 'content', " + prompt[1:] + ")), json('[]'))"),
        "Collected_content": initialize("content", "array", [], {"Messages": ["Succeeded"]}),
        "Stop_reason": initialize("stopReason", "string", "pause_turn", {"Collected_content": ["Succeeded"]}),
        "User_content": initialize("userContent", "array", [], {"Stop_reason": ["Succeeded"]}),
        "Uploaded_files": initialize("uploadedFiles", "array", [], {"User_content": ["Succeeded"]}),
        "Batch_ids": initialize("batchIds", "array", [], {"Uploaded_files": ["Succeeded"]}),
        "Container": initialize("containerId", "string", "", {"Batch_ids": ["Succeeded"]}),
    }
    claude = {"type": "OpenApiConnection", "runAfter": {}, "runtimeConfiguration": {"secureData": {"properties": ["inputs", "outputs"]}}, "inputs": {
        "host": {"apiId": connector_api, "connectionName": "claude", "operationId": "Messages"},
        "retryPolicy": {"type": "none"},
        "parameters": {"anthropic-version": "2023-06-01", "body": {
            "model": MODEL, "max_tokens": 24000, "system": (ROOT / "flows/schedule-search/system.txt").read_text(encoding="utf-8"),
            "container": "@if(empty(variables('containerId')), null, variables('containerId'))",
            "messages": "@variables('messages')", "tools": [
                {"type": "web_search_20250305", "name": "web_search", "max_uses": 5},
                {"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 5, "max_content_tokens": 20000},
                {"type": "code_execution_20250825", "name": "code_execution"}
            ]
        }}
    }}
    key_action = None
    if credential_mode != "connection":
        secure = {"secureData": {"properties": ["inputs", "outputs"]}}
        if credential_mode == "secretEnvironmentVariable":
            key_action = {"type": "OpenApiConnection", "runAfter": {"Mark_searching": ["Succeeded"]}, "runtimeConfiguration": secure,
                "inputs": {"host": {"apiId": dv["apiId"], "connectionName": "dataverse", "operationId": "PerformUnboundAction"},
                    "parameters": {"actionName": "RetrieveEnvironmentVariableSecretValue", "item/EnvironmentVariableName": KEY_SCHEMA}}}
            key = "@body('Get_Claude_key')?['EnvironmentVariableSecretValue']"
        else:
            key_action = {"type": "OpenApiConnection", "runAfter": {"Mark_searching": ["Succeeded"]}, "runtimeConfiguration": secure,
                "inputs": {"host": {"apiId": dv["apiId"], "connectionName": "dataverse", "operationId": "ListRecords"},
                    "parameters": {"entityName": "environmentvariabledefinitions", "$filter": f"schemaname eq '{KEY_SCHEMA}'",
                        "$select": "environmentvariabledefinitionid,defaultvalue", "$top": 1,
                        "$expand": "environmentvariabledefinition_environmentvariablevalue($select=value)"}}}
            key = "@coalesce(first(body('Get_Claude_key')?['value'])?['environmentvariabledefinition_environmentvariablevalue']?[0]?['value'], first(body('Get_Claude_key')?['value'])?['defaultvalue'])"
        # The key exists only in masked action output and the masked HTTP header.
        # No variable/Compose output or exported parameter contains the value.
        claude = {"type": "Http", "runAfter": {}, "runtimeConfiguration": secure, "inputs": {
            "method": "POST", "uri": "https://api.anthropic.com/v1/messages", "retryPolicy": {"type": "none"},
            "headers": {"x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "files-api-2025-04-14", "Content-Type": "application/json"},
            "body": claude["inputs"]["parameters"]["body"]}}
    # Drop large fetched documents/PDFs from the client result, retaining their
    # actual tool-returned URL and metadata. Continuation messages retain the full
    # original content required by Anthropic's server-tool protocol.
    clean = "@if(equals(items('Collect_blocks')?['type'], 'web_fetch_tool_result'), setProperty(setProperty(json('{}'), 'type', 'web_fetch_tool_result'), 'content', removeProperty(items('Collect_blocks')?['content'], 'content')), items('Collect_blocks'))"
    loop = {"type": "Until", "runAfter": {"Mark_searching": ["Succeeded"]}, "expression": "@not(equals(variables('stopReason'), 'pause_turn'))", "limit": {"count": 3, "timeout": "PT8M"}, "actions": {
        "Claude_messages": claude,
        "Collect_blocks": {"type": "Foreach", "runAfter": {"Claude_messages": ["Succeeded"]}, "foreach": "@body('Claude_messages')?['content']", "runtimeConfiguration": {"concurrency": {"repetitions": 1}}, "actions": {
            "Collect_block": {"type": "AppendToArrayVariable", "inputs": {"name": "content", "value": clean}, "runAfter": {}}
        }},
        "Continue_message": {"type": "AppendToArrayVariable", "runAfter": {"Collect_blocks": ["Succeeded"]}, "inputs": {"name": "messages", "value": {"role": "assistant", "content": "@body('Claude_messages')?['content']"}}},
        "Set_stop_reason": {"type": "SetVariable", "runAfter": {"Continue_message": ["Succeeded"]}, "inputs": {"name": "stopReason", "value": "@coalesce(body('Claude_messages')?['stop_reason'], 'error')"}},
        "Remember_container": {"type": "SetVariable", "runAfter": {"Set_stop_reason": ["Succeeded"]}, "inputs": {"name": "containerId", "value": "@coalesce(body('Claude_messages')?['container']?['id'], '')"}}
    }}
    work = {"type": "Scope", "runAfter": {"Container": ["Succeeded"]}, "actions": {
        "Mark_searching": update({"cr9cd_status": "searching"}),
        "Research": loop,
        "Check_completed": {"type": "If", "runAfter": {"Research": ["Succeeded"]}, "expression": {"equals": ["@variables('stopReason')", "end_turn"]}, "actions": {
            "Save_result": update({"cr9cd_status": "complete", "cr9cd_result": "@string(setProperty(setProperty(setProperty(json('{}'), 'content', variables('content')), 'stop_reason', variables('stopReason')), 'uploads', variables('uploadedFiles')))", "cr9cd_error": ""})
        }, "else": {"actions": {"Save_incomplete": update({"cr9cd_status": "failed", "cr9cd_error": "The schedule search did not finish. Try a narrower team/date query."})}}}
    }}
    if key_action:
        work["actions"]["Get_Claude_key"] = key_action
        file_host = {"apiId": dv["apiId"], "connectionName": "dataverse", "operationId": "GetItem"}
        headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-beta": "files-api-2025-04-14"}
        file = "json(triggerBody()?['cr9cd_input'])?['files'][items('Upload_files')]"
        work["actions"]["Upload_files"] = {"type": "Foreach", "runAfter": {"Get_Claude_key": ["Succeeded"]},
            "foreach": "@range(0, length(coalesce(json(triggerBody()?['cr9cd_input'])?['files'], json('[]'))))", "runtimeConfiguration": {"concurrency": {"repetitions": 1}}, "actions": {
                "Read_upload": {"type": "OpenApiConnection", "runAfter": {}, "runtimeConfiguration": secure, "inputs": {"host": file_host,
                    "parameters": {"entityName": "annotations", "recordId": "@" + file + "?['annotationId']", "$select": "documentbody,filename,mimetype"}}},
                "Claude_upload": {"type": "Http", "runAfter": {"Read_upload": ["Succeeded"]}, "runtimeConfiguration": secure, "inputs": {
                    "method": "POST", "uri": "https://api.anthropic.com/v1/files", "headers": headers, "retryPolicy": {"type": "none"},
                    "body": {"$content-type": "multipart/form-data", "$multipart": [{"headers": {
                        "Content-Disposition": "@concat('form-data; name=\"file\"; filename=\"', body('Read_upload')?['filename'], '\"')",
                        "Content-Type": "@body('Read_upload')?['mimetype']"}, "body": "@base64ToBinary(body('Read_upload')?['documentbody'])"}]}}},
                "Remember_upload": {"type": "AppendToArrayVariable", "runAfter": {"Claude_upload": ["Succeeded"]},
                    "inputs": {"name": "uploadedFiles", "value": "@setProperty(setProperty(json('{}'), 'annotationId', " + file + "?['annotationId']), 'fileId', body('Claude_upload')?['id'])"}},
                "Attach_upload": {"type": "AppendToArrayVariable", "runAfter": {"Remember_upload": ["Succeeded"]},
                    "inputs": {"name": "userContent", "value": "@if(equals(body('Read_upload')?['mimetype'], 'application/pdf'), setProperty(json('{\"type\":\"document\"}'), 'source', setProperty(json('{\"type\":\"file\"}'), 'file_id', body('Claude_upload')?['id'])), if(contains(createArray('image/png','image/jpeg','image/gif','image/webp'), body('Read_upload')?['mimetype']), setProperty(json('{\"type\":\"image\"}'), 'source', setProperty(json('{\"type\":\"file\"}'), 'file_id', body('Claude_upload')?['id'])), setProperty(json('{\"type\":\"container_upload\"}'), 'file_id', body('Claude_upload')?['id'])))"}}
            }}
        public_research = work["actions"].pop("Research")
        public_check = work["actions"].pop("Check_completed")
        public_research["runAfter"] = {}
        # No private prompt, file bytes or Claude response ever enters a variable.
        # Each private continuation reads only earlier MASKED HTTP outputs.
        user_message = "setProperty(json('{\"role\":\"user\"}'), 'content', concat(createArray(setProperty(json('{\"type\":\"text\"}'), 'text', " + prompt[1:] + ")), variables('userContent')))"
        # Each batch contains exactly one request. Polling avoids Power Automate's
        # two-minute synchronous HTTP limit for spreadsheet analysis. Private
        # content stays exclusively in masked HTTP/Dataverse actions.
        calls = {}
        for index in range(1, 4):
            params = deepcopy(claude["inputs"]["body"])
            parts = [user_message] + ["setProperty(json('{\"role\":\"assistant\"}'), 'content', json(trim(string(body('Private_Claude_" + str(prior) + "'))))?['result']?['message']?['content'])" for prior in range(1, index)]
            params["messages"] = "@createArray(" + ", ".join(parts) + ")"
            params["container"] = None if index == 1 else "@json(trim(string(body('Private_Claude_" + str(index - 1) + "'))))?['result']?['message']?['container']?['id']"
            submit, remember, wait, status, result = [name + str(index) for name in ["Submit_private_", "Remember_batch_", "Await_private_", "Private_status_", "Private_Claude_"]]
            batch_uri = "@concat('https://api.anthropic.com/v1/messages/batches/', body('" + submit + "')?['id'])"
            def http(method, uri, after=None, body=None):
                inputs = {"method": method, "uri": uri, "headers": {**headers, "Content-Type": "application/json"}, "retryPolicy": {"type": "none"}}
                if body is not None:
                    inputs["body"] = body
                return {"type": "Http", "runAfter": after or {}, "runtimeConfiguration": secure, "inputs": inputs}
            calls[index] = {"type": "Scope", "runAfter": {}, "actions": {
                submit: http("POST", "https://api.anthropic.com/v1/messages/batches", body={"requests": [{"custom_id": "@triggerBody()?['cr9cd_schedulesearchid']", "params": params}]}),
                remember: {"type": "AppendToArrayVariable", "runAfter": {submit: ["Succeeded"]}, "inputs": {"name": "batchIds", "value": "@body('" + submit + "')?['id']"}},
                wait: {"type": "Until", "runAfter": {remember: ["Succeeded"]}, "expression": "@equals(body('" + status + "')?['processing_status'], 'ended')", "limit": {"count": 120, "timeout": "PT1H"}, "operationOptions": "FailWhenLimitsReached", "actions": {
                    "Delay_private_" + str(index): {"type": "Wait", "runAfter": {}, "inputs": {"interval": {"count": 30, "unit": "Second"}}},
                    status: http("GET", batch_uri, {"Delay_private_" + str(index): ["Succeeded"]})
                }},
                result: http("GET", "@concat('https://api.anthropic.com/v1/messages/batches/', body('" + submit + "')?['id'], '/results')", {wait: ["Succeeded"]})
            }}
        pause2 = {"type": "If", "runAfter": {"Private_round_2": ["Succeeded"]}, "expression": {"equals": ["@json(trim(string(body('Private_Claude_2'))))?['result']?['message']?['stop_reason']", "pause_turn"]}, "actions": {"Private_round_3": calls[3]}, "else": {"actions": {}}}
        pause1 = {"type": "If", "runAfter": {"Private_round_1": ["Succeeded"]}, "expression": {"equals": ["@json(trim(string(body('Private_Claude_1'))))?['result']?['message']?['stop_reason']", "pause_turn"]}, "actions": {"Private_round_2": calls[2], "Private_pause_2": pause2}, "else": {"actions": {}}}
        final_reason = "if(equals(actions('Private_Claude_3')?['status'], 'Succeeded'), json(trim(string(body('Private_Claude_3'))))?['result']?['message']?['stop_reason'], if(equals(actions('Private_Claude_2')?['status'], 'Succeeded'), json(trim(string(body('Private_Claude_2'))))?['result']?['message']?['stop_reason'], json(trim(string(body('Private_Claude_1'))))?['result']?['message']?['stop_reason']))"
        content = "concat(json(trim(string(body('Private_Claude_1'))))?['result']?['message']?['content'], if(equals(actions('Private_Claude_2')?['status'], 'Succeeded'), json(trim(string(body('Private_Claude_2'))))?['result']?['message']?['content'], json('[]')), if(equals(actions('Private_Claude_3')?['status'], 'Succeeded'), json(trim(string(body('Private_Claude_3'))))?['result']?['message']?['content'], json('[]')))"
        save = update({"cr9cd_status": "complete", "cr9cd_result": "@string(setProperty(setProperty(setProperty(json('{}'), 'content', " + content + "), 'stop_reason', " + final_reason + "), 'uploads', variables('uploadedFiles')))", "cr9cd_error": ""})
        save["runtimeConfiguration"] = secure
        private_check = {"type": "If", "runAfter": {"Private_pause_1": ["Succeeded"]}, "expression": {"equals": ["@" + final_reason, "end_turn"]}, "actions": {"Save_private_result": save}, "else": {"actions": {"Private_incomplete": update({"cr9cd_status": "failed", "cr9cd_error": "The file preparation did not finish. Try fewer files or a narrower request."})}}}
        work["actions"]["Choose_import_path"] = {"type": "If", "runAfter": {"Upload_files": ["Succeeded"]}, "expression": {"greater": ["@length(variables('uploadedFiles'))", 0]},
            "actions": {"Private_round_1": calls[1], "Private_pause_1": pause1, "Check_private_complete": private_check}, "else": {"actions": {"Research": public_research, "Check_completed": public_check}}}
        # Cancel unfinished requests before removing their files. Completed batches
        # are deleted so private batch results are not left in the Claude console.
        cleanup_uri = "@concat('https://api.anthropic.com/v1/messages/batches/', items('Cleanup_private_batches'))"
        actions["Cleanup_private_batches"] = {"type": "Foreach", "foreach": "@variables('batchIds')", "runAfter": {"Find_schedule": ["Succeeded", "Failed", "TimedOut", "Skipped"]}, "runtimeConfiguration": {"concurrency": {"repetitions": 1}}, "actions": {
            "Cleanup_batch_status": http("GET", cleanup_uri),
            "Check_batch_finished": {"type": "If", "runAfter": {"Cleanup_batch_status": ["Succeeded"]}, "expression": {"equals": ["@body('Cleanup_batch_status')?['processing_status']", "ended"]}, "actions": {"Delete_private_batch": http("DELETE", cleanup_uri)}, "else": {"actions": {
                "Cancel_private_batch": http("POST", "@concat('https://api.anthropic.com/v1/messages/batches/', items('Cleanup_private_batches'), '/cancel')"),
                "Wait_for_cancellation": {"type": "Until", "runAfter": {"Cancel_private_batch": ["Succeeded"]}, "expression": "@equals(body('Cancelled_batch_status')?['processing_status'], 'ended')", "limit": {"count": 20, "timeout": "PT10M"}, "operationOptions": "FailWhenLimitsReached", "actions": {
                    "Cancellation_delay": {"type": "Wait", "runAfter": {}, "inputs": {"interval": {"count": 30, "unit": "Second"}}},
                    "Cancelled_batch_status": http("GET", cleanup_uri, {"Cancellation_delay": ["Succeeded"]})
                }},
                "Delete_cancelled_batch": http("DELETE", cleanup_uri, {"Wait_for_cancellation": ["Succeeded"]})
            }}}
        }}
        actions["Delete_Claude_uploads"] = {"type": "Foreach", "foreach": "@variables('uploadedFiles')", "runAfter": {"Cleanup_private_batches": ["Succeeded", "Failed", "TimedOut", "Skipped"]},
            "runtimeConfiguration": {"concurrency": {"repetitions": 1}}, "actions": {"Delete_Claude_file": {"type": "Http", "runAfter": {}, "runtimeConfiguration": secure,
                "inputs": {"method": "DELETE", "uri": "@concat('https://api.anthropic.com/v1/files/', items('Delete_Claude_uploads')?['fileId'])", "headers": headers, "retryPolicy": {"type": "none"}}}}}
    actions["Find_schedule"] = work
    actions["Save_failure"] = update({"cr9cd_status": "failed", "cr9cd_error": "Schedule search could not complete. Try again or use a narrower team/date query."}, {"Find_schedule": ["Failed", "TimedOut", "Skipped"], "Messages": ["Succeeded", "Failed", "TimedOut", "Skipped"], "Collected_content": ["Succeeded", "Failed", "TimedOut", "Skipped"], "Stop_reason": ["Succeeded", "Failed", "TimedOut", "Skipped"]})
    return {"$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#", "contentVersion": "1.0.0.0",
            "parameters": {"$authentication": {"type": "SecureObject", "defaultValue": {}}, "$connections": {"type": "Object", "defaultValue": {}}},
            "triggers": {"When_search_is_requested": {"type": "OpenApiConnectionWebhook", "runtimeConfiguration": {"secureData": {"properties": ["outputs"]}}, "inputs": {"host": {"apiId": "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps", "connectionName": "dataverse", "operationId": "SubscribeWebhookTrigger"}, "parameters": {
                "subscriptionRequest/message": 1, "subscriptionRequest/entityname": TABLE, "subscriptionRequest/scope": 4, "subscriptionRequest/filterexpression": "cr9cd_status eq 'queued'"
            }}}}, "actions": actions}


def walk_actions(flow):
    """Visit actions in scopes, loops and both conditional branches."""
    for name, action in flow.get("actions", {}).items():
        yield name, action
        yield from walk_actions(action)
        yield from walk_actions(action.get("else", {}))


def assert_protected_actions(flow):
    """Check all credential/private-content actions without inspecting secrets."""
    for name, action in walk_actions(flow):
        if action["type"] in ["Http", "Compose"] or name in ["Get_Claude_key", "Read_upload", "Save_private_result"]:
            if set(action.get("runtimeConfiguration", {}).get("secureData", {}).get("properties", [])) != {"inputs", "outputs"}:
                raise RuntimeError("A credential or private-content action is missing secure inputs/outputs: " + name)
    if flow["triggers"]["When_search_is_requested"].get("runtimeConfiguration", {}).get("secureData", {}).get("properties") != ["outputs"]:
        raise RuntimeError("The AI Import trigger output must be masked.")
