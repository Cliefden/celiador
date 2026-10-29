#!/usr/bin/env python3
"""Create or update the App Store review detail for version 1.0 from fastlane/.env.

Apple requires a contact phone; the lane refuses to run without REVIEW_PHONE.
Uses the shared App Store Connect helper in Apps-AppStore/xcode-cloud-setup/asc.py.
"""
import os, sys, json, pathlib

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "xcode-cloud-setup"))
from asc import call  # noqa: E402

VERSION_ID = "4066e6fc-ea38-418a-bc29-4f27ccb3c289"  # App Store version 1.0

def env(name, default=None):
    value = os.environ.get(name, default)
    if value is None or value == "":
        # fastlane loads fastlane/.env into the environment; running the script directly does not
        for line in (HERE / ".env").read_text().splitlines() if (HERE / ".env").exists() else []:
            if line.startswith(name + "="):
                value = line.split("=", 1)[1].strip()
    return value

phone = env("REVIEW_PHONE")
if not phone:
    sys.exit("REVIEW_PHONE is empty in fastlane/.env — Apple requires a contact phone for App Review.")
attrs = {
    "contactFirstName": env("REVIEW_FIRST_NAME", "Stefan"),
    "contactLastName": env("REVIEW_LAST_NAME", "Wiklund"),
    "contactEmail": env("REVIEW_EMAIL", "stefan@celiador.ai"),
    "contactPhone": phone,
    "demoAccountName": env("REVIEW_DEMO_USER"),
    "demoAccountPassword": env("REVIEW_DEMO_PASSWORD"),
    "demoAccountRequired": True,
    "notes": (HERE / "metadata" / "review_information" / "notes.txt").read_text(),
}
status, res = call("GET", f"/v1/appStoreVersions/{VERSION_ID}/appStoreReviewDetail")
existing = (res or {}).get("data")
if existing:
    status, res = call("PATCH", f"/v1/appStoreReviewDetails/{existing['id']}",
                       {"data": {"type": "appStoreReviewDetails", "id": existing["id"], "attributes": attrs}})
else:
    status, res = call("POST", "/v1/appStoreReviewDetails",
                       {"data": {"type": "appStoreReviewDetails", "attributes": attrs,
                                 "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": VERSION_ID}}}}})
print(status, "review detail", (res or {}).get("data", {}).get("id") or json.dumps(res)[:300])
sys.exit(0 if status < 300 else 1)
