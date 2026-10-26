"""Silent PAC credentials for the schedule flow's Microsoft control-plane APIs.

No Azure CLI, interactive fallback, cache writes or token output. Every token
must belong to the known emikes@ais-now.com user in the AIS tenant.
"""
import base64
import json
import os
from pathlib import Path

import msal
from msal_extensions import FilePersistenceWithDataProtection
import requests

from dataverse_api import TENANT

SOURCE_ORG = "https://orgfca328be.crm.dynamics.com"
USER_OBJECT_ID = "346dc49a-160d-4c1c-be89-56cd0fb87033"


def token(resource):
    allowed = {SOURCE_ORG, "https://service.powerapps.com/", "https://service.flow.microsoft.com/", "https://api.powerplatform.com"}
    if resource not in allowed:
        raise RuntimeError("Unapproved service token audience.")
    path = Path(os.environ["LOCALAPPDATA"]) / "Microsoft/PowerAppsCli/tokencache_msalv3.dat"
    cache = msal.SerializableTokenCache()
    cache.deserialize(FilePersistenceWithDataProtection(str(path)).load())
    app = msal.PublicClientApplication("9cee029c-6210-4654-90bb-17e6e9d36617", authority=f"https://login.microsoftonline.com/{TENANT}", token_cache=cache)
    account = next((a for a in app.get_accounts(username="emikes@ais-now.com") if a.get("realm") == TENANT), None)
    if not account:
        raise RuntimeError("The emikes@ais-now.com PAC login is unavailable.")
    result = app.acquire_token_silent([resource.rstrip("/") + "/.default"], account=account)
    if not result or "access_token" not in result:
        raise RuntimeError("Silent service authentication is unavailable; no interactive sign-in was attempted.")
    value = result["access_token"]
    part = value.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    if claims.get("oid", "").lower() != USER_OBJECT_ID or claims.get("tid", "").lower() != TENANT:
        raise RuntimeError("Refusing a service token for another identity.")
    return value


def source_get(path, params=None):
    session = requests.Session()
    session.headers.update({"Authorization": "Bearer " + token(SOURCE_ORG), "Accept": "application/json"})
    base = SOURCE_ORG + "/api/data/v9.2/"
    who = session.get(base + "WhoAmI", timeout=45)
    who.raise_for_status()
    user = session.get(base + f"systemusers({who.json()['UserId']})", params={"$select": "domainname,isdisabled"}, timeout=45)
    user.raise_for_status()
    if user.json().get("domainname", "").lower() != "emikes@ais-now.com" or user.json().get("isdisabled"):
        raise RuntimeError("Refusing another source Dataverse user.")
    response = session.get(base + path, params=params, timeout=45)
    if not response.ok:
        raise RuntimeError(f"Source metadata read failed with HTTP {response.status_code}.")
    return response.json()
