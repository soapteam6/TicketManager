"""Credential-free definition builder for the background Claude schedule search."""
from pathlib import Path

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
    actions = {
        "Messages": initialize("messages", "array", [{"role": "user", "content": prompt}]),
        "Collected_content": initialize("content", "array", [], {"Messages": ["Succeeded"]}),
        "Stop_reason": initialize("stopReason", "string", "pause_turn", {"Collected_content": ["Succeeded"]}),
    }
    claude = {"type": "OpenApiConnection", "runAfter": {}, "runtimeConfiguration": {"secureData": {"properties": ["inputs", "outputs"]}}, "inputs": {
        "host": {"apiId": connector_api, "connectionName": "claude", "operationId": "Messages"},
        "retryPolicy": {"type": "none"},
        "parameters": {"anthropic-version": "2023-06-01", "body": {
            "model": MODEL, "max_tokens": 16000, "system": (ROOT / "flows/schedule-search/system.txt").read_text(encoding="utf-8"),
            "messages": "@variables('messages')", "tools": [
                {"type": "web_search_20250305", "name": "web_search", "max_uses": 5},
                {"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 5, "max_content_tokens": 20000}
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
            "headers": {"x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
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
        "Set_stop_reason": {"type": "SetVariable", "runAfter": {"Continue_message": ["Succeeded"]}, "inputs": {"name": "stopReason", "value": "@coalesce(body('Claude_messages')?['stop_reason'], 'error')"}}
    }}
    work = {"type": "Scope", "runAfter": {"Stop_reason": ["Succeeded"]}, "actions": {
        "Mark_searching": update({"cr9cd_status": "searching"}),
        "Research": loop,
        "Check_completed": {"type": "If", "runAfter": {"Research": ["Succeeded"]}, "expression": {"equals": ["@variables('stopReason')", "end_turn"]}, "actions": {
            "Save_result": update({"cr9cd_status": "complete", "cr9cd_result": "@string(setProperty(setProperty(json('{}'), 'content', variables('content')), 'stop_reason', variables('stopReason')))", "cr9cd_error": ""})
        }, "else": {"actions": {"Save_incomplete": update({"cr9cd_status": "failed", "cr9cd_error": "The schedule search did not finish. Try a narrower team/date query."})}}}
    }}
    if key_action:
        work["actions"]["Get_Claude_key"] = key_action
        work["actions"]["Research"]["runAfter"] = {"Get_Claude_key": ["Succeeded"]}
    actions["Find_schedule"] = work
    actions["Save_failure"] = update({"cr9cd_status": "failed", "cr9cd_error": "Schedule search could not complete. Try again or use a narrower team/date query."}, {"Find_schedule": ["Failed", "TimedOut", "Skipped"], "Messages": ["Succeeded", "Failed", "TimedOut", "Skipped"], "Collected_content": ["Succeeded", "Failed", "TimedOut", "Skipped"], "Stop_reason": ["Succeeded", "Failed", "TimedOut", "Skipped"]})
    return {"$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#", "contentVersion": "1.0.0.0",
            "parameters": {"$authentication": {"type": "SecureObject", "defaultValue": {}}, "$connections": {"type": "Object", "defaultValue": {}}},
            "triggers": {"When_search_is_requested": {"type": "OpenApiConnectionWebhook", "inputs": {"host": {"apiId": "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps", "connectionName": "dataverse", "operationId": "SubscribeWebhookTrigger"}, "parameters": {
                "subscriptionRequest/message": 1, "subscriptionRequest/entityname": TABLE, "subscriptionRequest/scope": 4, "subscriptionRequest/filterexpression": "cr9cd_status eq 'queued'"
            }}}}, "actions": actions}
