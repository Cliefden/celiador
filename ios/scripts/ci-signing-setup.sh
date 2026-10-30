#!/bin/bash
# One-time setup for the GitHub Actions build of the iPhone app
# (.github/workflows/ios.yml, TESTFLIGHT.md § One-time setup). Run it from
# anywhere on a Mac with `asc` (github.com/rudrankriyam/App-Store-Connect-CLI)
# signed in to the Celiador team as the profile `celiador`, and `gh` signed in
# to GitHub. Re-run it to rotate: it creates a fresh certificate every time
# (revoke the old one in App Store Connect afterwards).
#
# What it does:
#   1. Generates a private key + CSR here (never leaves this machine except in
#      the p12 below) and asks App Store Connect for an Apple Distribution
#      certificate for it — a certificate only the workflow uses, so revoking it
#      never touches the one in your login keychain. Apple allows three.
#   2. Packages certificate + key as a password-protected .p12.
#   3. Writes the repository secrets the workflow reads:
#        ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY   the App Store Connect API key
#                                                      (App Manager role is enough)
#        IOS_DIST_P12_BASE64, IOS_DIST_P12_PASSWORD   the certificate
#   4. Deletes the local key material.
#
#   ios/scripts/ci-signing-setup.sh [--repo Cliefden/celiador] [--profile celiador] [--key-id R73AU5822H]
#
# Nothing is printed that would have to be kept secret.

set -euo pipefail

repo="Cliefden/celiador"
profile="celiador"
key_id="R73AU5822H"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) repo="$2"; shift 2 ;;
    --profile) profile="$2"; shift 2 ;;
    --key-id) key_id="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

for tool in asc gh openssl base64 uuidgen; do
  command -v "$tool" >/dev/null || { echo "✘ $tool is not on PATH" >&2; exit 1; }
done

key_path="$HOME/.appstoreconnect/private_keys/AuthKey_$key_id.p8"
[[ -f "$key_path" ]] || { echo "✘ $key_path not found — download the API key's .p8 from App Store Connect → Users and Access → Integrations" >&2; exit 1; }

issuer_id="$(asc --profile "$profile" auth issuer-id)"
[[ -n "$issuer_id" ]] || { echo "✘ asc has no issuer id for profile '$profile'" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"

echo "→ generating a private key and CSR"
asc certificates csr generate --common-name "Celiador CI (GitHub Actions)" \
  --key-out "$work/ci.key" --csr-out "$work/ci.csr" --output json >/dev/null

echo "→ asking App Store Connect for an Apple Distribution certificate"
asc --profile "$profile" certificates create --certificate-type DISTRIBUTION \
  --csr "$work/ci.csr" --output json > "$work/cert.json"
cert_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["data"]["id"])' "$work/cert.json")"
python3 -c 'import json,sys,base64; sys.stdout.buffer.write(base64.b64decode(json.load(open(sys.argv[1]))["data"]["attributes"]["certificateContent"]))' \
  "$work/cert.json" > "$work/ci.cer"
echo "   certificate $cert_id ($(openssl x509 -in "$work/ci.cer" -inform DER -noout -enddate | cut -d= -f2))"

echo "→ packaging the .p12"
uuidgen | tr -d '\n' > "$work/p12.password"
chmod 600 "$work/p12.password"
asc certificates export --certificate "$work/ci.cer" --private-key "$work/ci.key" \
  --csr "$work/ci.csr" --password-file "$work/p12.password" --p12-out "$work/ci-modern.p12" --output json >/dev/null
# asc writes a modern PKCS#12 (PBES2 / AES-256) that macOS `security import`
# cannot decode ("Unable to decode the provided data"); re-wrap it with the
# legacy 3DES / SHA-1 algorithms. The workflow does the same defensively.
openssl pkcs12 -in "$work/ci-modern.p12" -passin "file:$work/p12.password" -nodes -out "$work/ci.pem"
openssl pkcs12 -export -in "$work/ci.pem" -out "$work/ci.p12" -passout "file:$work/p12.password" \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1
rm -f "$work/ci.pem" "$work/ci-modern.p12"

echo "→ writing the repository secrets on $repo"
{
  printf 'ASC_KEY_ID=%s\n' "$key_id"
  printf 'ASC_ISSUER_ID=%s\n' "$issuer_id"
  # dotenv: a double-quoted value keeps the PEM's newlines as \n escapes.
  printf 'ASC_PRIVATE_KEY="%s"\n' "$(awk 'BEGIN{ORS="\\n"} {print}' "$key_path")"
  printf 'IOS_DIST_P12_BASE64=%s\n' "$(base64 < "$work/ci.p12" | tr -d '\n')"
  printf 'IOS_DIST_P12_PASSWORD=%s\n' "$(cat "$work/p12.password")"
} > "$work/secrets.env"
chmod 600 "$work/secrets.env"
gh secret set -R "$repo" -f "$work/secrets.env"

echo "✔ done. Secrets set: ASC_KEY_ID ASC_ISSUER_ID ASC_PRIVATE_KEY IOS_DIST_P12_BASE64 IOS_DIST_P12_PASSWORD"
echo "  Certificate $cert_id is the workflow's; revoke it in App Store Connect to rotate."
echo "  Next: push to main touching ios/, or: gh workflow run ios.yml -R $repo -f channel=dev"
