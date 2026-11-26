#!/usr/bin/env bash
# Breaking changes in the daemon's API since a git ref (#161).
#
#   packages/client/scripts/breaking-since.sh <ref> [<spec>]
#
# Compares packages/client/openapi.yaml at <ref> (a release tag, a base branch)
# with <spec> (default: the working tree's) using oasdiff, pinned below and
# downloaded once into ~/.cache/celiador (checksum-verified) unless that exact
# version is on PATH.
#
# Exit: 0 = additive only, or <ref> has no spec yet; 1 = breaking changes
# (listed); 2 = couldn't check.
set -euo pipefail

OASDIFF_VERSION=1.36.0
# sha256 of the release archives (the release's checksums.txt).
SHA_linux_amd64=dba65661f6d0f178a3e4884c309f19527a849388bb9df0e81545db76dbb697d6
SHA_linux_arm64=85eff4bc96334e19996c9ec819c5c10bb5a8f2fd070511f7d98ab96ec4f9933b
SHA_darwin_all=ae7f517e4fcaab0e6e1e2f1a81112cb1083b4fefa19db9706e2e728531cca8ce

ref="${1:-}"
[[ -n "$ref" ]] || { echo "usage: breaking-since.sh <ref> [<spec>]" >&2; exit 2; }
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
spec="${2:-$root/packages/client/openapi.yaml}"

oasdiff_bin() {
  if command -v oasdiff >/dev/null 2>&1 && [[ "$(oasdiff --version 2>/dev/null)" == *"$OASDIFF_VERSION"* ]]; then
    command -v oasdiff; return
  fi
  local os arch platform sha dir archive
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$os/$arch" in
    darwin/*) platform=darwin_all ;;
    linux/x86_64) platform=linux_amd64 ;;
    linux/aarch64 | linux/arm64) platform=linux_arm64 ;;
    *) echo "breaking-since: no pinned oasdiff for $os/$arch" >&2; return 2 ;;
  esac
  sha_var="SHA_$platform"; sha="${!sha_var}"
  dir="${XDG_CACHE_HOME:-$HOME/.cache}/celiador/oasdiff-$OASDIFF_VERSION"
  if [[ ! -x "$dir/oasdiff" ]]; then
    mkdir -p "$dir"
    archive="$dir/oasdiff_${OASDIFF_VERSION}_${platform}.tar.gz"
    curl -fsSL -o "$archive" "https://github.com/oasdiff/oasdiff/releases/download/v${OASDIFF_VERSION}/oasdiff_${OASDIFF_VERSION}_${platform}.tar.gz" >&2
    if [[ "$(shasum -a 256 "$archive" | cut -d' ' -f1)" != "$sha" ]]; then
      rm -f "$archive"; echo "breaking-since: oasdiff checksum mismatch" >&2; return 2
    fi
    tar -xzf "$archive" -C "$dir" oasdiff
    rm -f "$archive"
  fi
  echo "$dir/oasdiff"
}

if ! git -C "$root" cat-file -e "$ref:packages/client/openapi.yaml" 2>/dev/null; then
  echo "breaking-since: $ref has no packages/client/openapi.yaml; nothing to compare."
  exit 0
fi
base="$(mktemp)"
trap 'rm -f "$base"' EXIT
git -C "$root" show "$ref:packages/client/openapi.yaml" >"$base"

bin="$(oasdiff_bin)" || exit 2
if "$bin" breaking "$base" "$spec" --fail-on ERR; then
  echo "breaking-since: no breaking API changes since $ref."
  exit 0
else
  status=$?
  # oasdiff exits 1 when --fail-on matched; anything else is a failure to check.
  [[ $status -eq 1 ]] && exit 1
  exit 2
fi
