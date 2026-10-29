#!/usr/bin/env python3
"""Who has been spending the shared Anthropic key, per UTC day.

Signs in with your Celiador account (the password is asked for, never stored)
and prints GET /api/admin/usage. Your account must be in the daemon's
CELIADOR_ADMIN_EMAILS (or CELIADOR_ADMIN_USER_IDS); anyone else gets 404.

  python3 scripts/admin-usage.py you@example.com [days] [--url=https://celiador.ai]
"""
import getpass
import json
import sys
import urllib.request

args = [a for a in sys.argv[1:] if not a.startswith("--url")]
url = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--url=")), "https://celiador.ai").rstrip("/")
if not args:
    sys.exit(__doc__)
email = args[0]
days = int(args[1]) if len(args) > 1 else 14


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(url + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("content-type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


_, config = call("GET", "/api/config")
status, session = call(
    "POST", "/auth/v1/token?grant_type=password",
    {"email": email, "password": getpass.getpass(f"Password for {email}: ")},
    {"apikey": config["supabaseAnonKey"]},
)
if status != 200:
    sys.exit(f"Sign-in failed ({status}): {session}")

status, report = call("GET", f"/api/admin/usage?days={days}", headers={"authorization": "Bearer " + session["access_token"]})
if status == 404:
    sys.exit(f"{email} is not an admin on {url} (add it to CELIADOR_ADMIN_EMAILS).")
if status != 200:
    sys.exit(f"Usage request failed ({status}): {report}")

for d in report["days"]:
    t = d["total"]
    print(f"\n{d['day']}  {d['accounts']} account(s)  {t['requests']} requests  {t['inputTokens']:,} in  {t['outputTokens']:,} out")
    for u in d["users"]:
        who = u["email"] or u["userId"]
        since = (u["createdAt"] or "")[:10]
        print(f"   {who:<40} since {since:<10} {u['requests']:>5} req {u['inputTokens']:>13,} in {u['outputTokens']:>11,} out")
