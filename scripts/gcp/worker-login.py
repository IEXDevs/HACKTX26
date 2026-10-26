"""Register a short-lived SSH key in the worker's region. Never log tokens."""
import json
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

key_file, project, region = sys.argv[1:]


def gcloud(*args):
    return subprocess.check_output(["gcloud", *args], text=True, stderr=subprocess.DEVNULL).strip()


account = gcloud("config", "get-value", "account")
token = gcloud("auth", "print-access-token")
query = urllib.parse.urlencode({"projectId": project, "regions": region})
url = f"https://oslogin.googleapis.com/v1/users/{urllib.parse.quote(account, safe='')}:importSshPublicKey?{query}"
payload = {
    "key": pathlib.Path(key_file).read_text().strip(),
    "expirationTimeUsec": str(int((time.time() + 600) * 1_000_000)),
}
request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={
    "Authorization": f"Bearer {token}", "Content-Type": "application/json",
})
try:
    with urllib.request.urlopen(request, timeout=30) as response:
        profile = json.load(response)["loginProfile"]
except urllib.error.HTTPError as error:
    detail = json.load(error).get("error", {}).get("message", "")
    raise SystemExit(f"Regional OS Login key registration failed (HTTP {error.code}): {detail}") from None
accounts = profile.get("posixAccounts", [])
linux = [entry for entry in accounts if entry.get("operatingSystemType", "LINUX") == "LINUX"]
if not linux:
    raise SystemExit("OS Login returned no Linux account.")
selected = next((entry for entry in linux if entry.get("primary")), linux[0])
print(selected["username"])
