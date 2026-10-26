"""AIS Development Web API access using the existing Power Platform CLI login.

Never prints or writes access tokens. No Azure CLI or interactive auth fallback.
"""
import json
import os
from pathlib import Path

import msal
from msal_extensions import FilePersistenceWithDataProtection
import requests

ORG = "https://org5c824bd0.crm.dynamics.com"
ENVIRONMENT = "946e5045-3200-eb26-9160-3fe967a6b21c"
TENANT = "a22e51ee-6f67-49b3-b98c-0e3a97d49b8a"


class Dataverse:
    def __init__(self):
        cache_path = Path(os.environ["LOCALAPPDATA"]) / "Microsoft/PowerAppsCli/tokencache_msalv3.dat"
        cache = msal.SerializableTokenCache()
        cache.deserialize(FilePersistenceWithDataProtection(str(cache_path)).load())
        app = msal.PublicClientApplication(
            "9cee029c-6210-4654-90bb-17e6e9d36617",
            authority=f"https://login.microsoftonline.com/{TENANT}", token_cache=cache,
        )
        accounts = app.get_accounts(username="emikes@ais-now.com")
        accounts = [a for a in accounts if a.get("realm") == TENANT]
        if not accounts:
            raise RuntimeError("Sign in to AIS Development with pac auth create first.")
        result = app.acquire_token_silent([ORG + "/.default"], account=accounts[0])
        if not result or "access_token" not in result:
            raise RuntimeError("Power Platform login expired. Refresh with pac auth create --environment " + ORG)
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": "Bearer " + result["access_token"],
            "Accept": "application/json", "OData-Version": "4.0", "OData-MaxVersion": "4.0",
        })
        who = self.call("GET", "WhoAmI")
        user = self.call("GET", f"systemusers({who['UserId']})?$select=internalemailaddress,domainname,isdisabled")
        if user.get("isdisabled") or user.get("domainname", "").lower() != "emikes@ais-now.com":
            raise RuntimeError("Refusing access: authenticated Dataverse user must be emikes@ais-now.com.")

    def call(self, method, path, body=None, **kwargs):
        response = self.session.request(method, ORG + "/api/data/v9.2/" + path,
                                        json=body, timeout=120, **kwargs)
        if not response.ok:
            raise RuntimeError(f"Dataverse {method} {path}: {response.status_code} {response.text[:2000]}")
        return response.json() if response.content else None


if __name__ == "__main__":
    print(json.dumps(Dataverse().call("GET", "WhoAmI"), indent=2))
