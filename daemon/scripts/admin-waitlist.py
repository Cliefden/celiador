#!/usr/bin/env python3
"""The website waitlist: list, export or erase sign-ups.

Signs in with your Celiador account (the password is asked for, never stored)
and calls GET/DELETE /api/admin/waitlist. Your account must be in the daemon's
CELIADOR_ADMIN_EMAILS (or CELIADOR_ADMIN_USER_IDS); anyone else gets 404.

  python3 scripts/admin-waitlist.py you@example.com                       # confirmed sign-ups
  python3 scripts/admin-waitlist.py you@example.com --list=windows --csv  # CSV for the announcement
  python3 scripts/admin-waitlist.py you@example.com --status=pending      # awaiting the confirm click
  python3 scripts/admin-waitlist.py you@example.com --delete=them@example.com   # erasure request
  [--url=https://celiador.ai]

The CSV carries each address's own unsubscribe link: put it in the mail's
footer and List-Unsubscribe header. Only confirmed addresses may be mailed.
"""
import getpass
import json
import sys
import urllib.parse
import urllib.request


def opt(name, default=None):
    return next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith(f"--{name}=")), default)


args = [a for a in sys.argv[1:] if not a.startswith("--")]
url = opt("url", "https://celiador.ai").rstrip("/")
if not args:
    sys.exit(__doc__)
email = args[0]


def call(method, path, body=None, headers=None, raw=False):
    req = urllib.request.Request(url + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("content-type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
            return r.status, data.decode() if raw else json.loads(data or b"null")
    except urllib.error.HTTPError as e:
        data = e.read()
        try:
            return e.code, json.loads(data or b"null")
        except ValueError:
            return e.code, data.decode(errors="replace")


_, config = call("GET", "/api/config")
status, session = call(
    "POST", "/auth/v1/token?grant_type=password",
    {"email": email, "password": getpass.getpass(f"Password for {email}: ")},
    {"apikey": config["supabaseAnonKey"]},
)
if status != 200:
    sys.exit(f"Sign-in failed ({status}): {session}")
auth = {"authorization": "Bearer " + session["access_token"]}

delete = opt("delete")
if delete:
    status, res = call("DELETE", "/api/admin/waitlist?" + urllib.parse.urlencode({"email": delete}), headers=auth)
    if status == 404:
        sys.exit(f"{email} is not an admin on {url} (add it to CELIADOR_ADMIN_EMAILS).")
    if status != 200:
        sys.exit(f"Delete failed ({status}): {res}")
    print(f"{delete}: {'removed' if res['removed'] else 'was not on the list'}")
    sys.exit(0)

query = {"status": opt("status", "confirmed")}
if opt("list"):
    query["list"] = opt("list")
csv = "--csv" in sys.argv
if csv:
    query["format"] = "csv"
status, res = call("GET", "/api/admin/waitlist?" + urllib.parse.urlencode(query), headers=auth, raw=csv)
if status == 404:
    sys.exit(f"{email} is not an admin on {url} (add it to CELIADOR_ADMIN_EMAILS).")
if status != 200:
    sys.exit(f"Waitlist request failed ({status}): {res}")

if csv:
    sys.stdout.write(res)
    sys.exit(0)

print(f"{res['count']} sign-up(s), status={query['status']}" + (f", list={query['list']}" if "list" in query else ""))
for e in res["entries"]:
    lists = ",".join(e["lists"]) or "-"
    pending = ",".join(e["pending"])
    confirmed = (e["confirmedAt"] or "")[:10] or "unconfirmed"
    print(f"   {e['email']:<40} {lists:<28} {confirmed:<11}" + (f" pending: {pending}" if pending else ""))
