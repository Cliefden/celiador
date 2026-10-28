#!/usr/bin/env bash
# Cut an iOS release: a vX.Y.Z tag on this repo starts the "Test" Xcode Cloud
# workflow (TESTFLIGHT.md), which archives the Celiador Test scheme and ships
# it to TestFlight. Tags are per repo — the daemon's release train
# (daemon/scripts/release.sh) tags the daemon, this tags the app.
#
#   scripts/release.sh <X.Y.Z | major | minor | patch> [--local]
#
#   X.Y.Z               the exact version to release
#   major/minor/patch   bump from the current MARKETING_VERSION
#   --local             skip the origin checks (rehearsals only)
#
# What it does, in order, refusing at the first problem:
#   1. clean main, equal to origin/main
#   2. the new version is greater, and its tag does not exist yet
#   3. set MARKETING_VERSION in project.yml (app, widgets and watch — they must
#      match; CURRENT_PROJECT_VERSION stays, Xcode Cloud numbers the builds)
#   4. commit "Release vX.Y.Z" and create an annotated tag
#
# It never pushes. Then, in two stages:
#   git push origin main        # Xcode's Default build (and, once the Dev
#                               # product exists, the Dev app on TestFlight)
#   git push origin vX.Y.Z      # the Test workflow → TestFlight
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

die() { echo "release: $*" >&2; exit 1; }

target="${1:-}"
local_only=false
[[ "${2:-}" == "--local" ]] && local_only=true
[[ -n "$target" ]] || die "usage: scripts/release.sh <X.Y.Z|major|minor|patch> [--local]"

# ── 1. clean main ────────────────────────────────────────────────────────────
[[ -z "$(git status --porcelain)" ]] || die "working tree is not clean"
[[ "$(git rev-parse --abbrev-ref HEAD)" == main ]] || die "not on main"
if [[ "$local_only" == false ]]; then
  git fetch --quiet origin main --tags
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] ||
    die "HEAD is not origin/main — push or pull first"
fi

# ── 2. next version ──────────────────────────────────────────────────────────
versions="$(sed -n 's/^ *MARKETING_VERSION: *"\([^"]*\)".*/\1/p' project.yml | sort -u)"
[[ -n "$versions" ]] || die "no MARKETING_VERSION in project.yml"
[[ "$(printf '%s\n' "$versions" | wc -l | tr -d ' ')" == 1 ]] ||
  die "project.yml targets disagree on MARKETING_VERSION: $(printf '%s ' $versions)"
current="$versions"
[[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "MARKETING_VERSION '$current' is not X.Y.Z"
major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"
case "$target" in
  major) next="$((major + 1)).0.0" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  patch) next="$major.$minor.$((patch + 1))" ;;
  *) next="$target" ;;
esac
[[ "$next" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "'$next' is not a stable X.Y.Z version"
n1="${BASH_REMATCH[1]}" n2="${BASH_REMATCH[2]}" n3="${BASH_REMATCH[3]}"
greater=false
if (( n1 > major )) || { (( n1 == major )) && (( n2 > minor )); } ||
   { (( n1 == major )) && (( n2 == minor )) && (( n3 > patch )); }; then
  greater=true
fi
[[ "$greater" == true ]] || die "$next is not greater than $current"
tag="v$next"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists locally"
if [[ "$local_only" == false ]] && git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  die "tag $tag already exists on origin"
fi

# ── 3. bump ──────────────────────────────────────────────────────────────────
sed -i '' "s/^\( *MARKETING_VERSION: *\)\"$current\"/\1\"$next\"/" project.yml
[[ "$(sed -n 's/^ *MARKETING_VERSION: *"\([^"]*\)".*/\1/p' project.yml | sort -u)" == "$next" ]] ||
  die "failed to set MARKETING_VERSION to $next"

# ── 4. commit and tag ────────────────────────────────────────────────────────
git add project.yml
git commit --quiet -m "Release $tag"
git tag -a "$tag" -m "$tag"

cat <<EOF

Created commit and tag $tag locally. NOT pushed.

  1) git push origin main       # main builds (Dev app once its product exists)
  2) git push origin $tag        # the Test workflow ships $next to TestFlight

Then attach What to Test notes to the processed build (TESTFLIGHT.md).
EOF
