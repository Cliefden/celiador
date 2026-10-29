#!/usr/bin/env bash
# Cut a Celiador release: one version for the daemon and the iOS app, one tag
# (RELEASING.md, ENVIRONMENTS.md). The editor has VS Code's version and releases
# on its own.
#
#   scripts/release.sh <X.Y.Z | major | minor | patch> [--local]
#
#   X.Y.Z               the exact version to release
#   major/minor/patch   bump from the current version
#   --local             skip the origin checks (rehearsals only)
#
# What it does, in order, refusing at the first problem:
#   1. clean main, equal to origin/main
#   2. the daemon (daemon/package.json) and the app (ios/project.yml
#      MARKETING_VERSION) agree on the current version; the new version is
#      greater and its tag does not exist yet
#   3. bump daemon/package.json + package-lock.json (npm version, no git tag)
#      and every MARKETING_VERSION in ios/project.yml
#   4. roll CHANGELOG.md: "## [Unreleased]" becomes "## [X.Y.Z] - <date>"
#   5. commit "Release vX.Y.Z" and create an annotated tag
#
# It never pushes. Then, in two stages:
#   git push origin main        # deploys daemon + web to dev; Dev app build
#   git push origin vX.Y.Z      # deploys daemon + web to test; Test app → TestFlight
# Never --follow-tags: both deploys would run at once on the same box.
#
# Below 1.0.0 the usual 0.x convention applies: a breaking client-facing change
# (daemon/docs/CLIENT_INTEGRATION.md) is a MINOR bump, additive changes and fixes
# are PATCH releases. Going to 1.0.0 is a deliberate decision.
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

# ── 2. current + next version ────────────────────────────────────────────────
current="$(node -p "require('./daemon/package.json').version")"
[[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "daemon/package.json version '$current' is not X.Y.Z"
major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"

ios_versions="$(sed -n 's/^ *MARKETING_VERSION: *"\([^"]*\)".*/\1/p' ios/project.yml | sort -u)"
[[ -n "$ios_versions" ]] || die "no MARKETING_VERSION in ios/project.yml"
[[ "$(printf '%s\n' "$ios_versions" | wc -l | tr -d ' ')" == 1 ]] ||
  die "ios/project.yml targets disagree on MARKETING_VERSION: $(printf '%s ' $ios_versions)"
[[ "$ios_versions" == "$current" ]] ||
  die "ios/project.yml says $ios_versions but daemon/package.json says $current — align them first (one version for the train)"

case "$target" in
  major) next="$((major + 1)).0.0" ;;
  minor) next="$major.$((minor + 1)).0" ;;
  patch) next="$major.$minor.$((patch + 1))" ;;
  *) next="$target" ;;
esac
[[ "$next" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "'$next' is not a stable X.Y.Z version"
greater="$(node -e '
  const p = (v) => v.split(".").map(Number);
  const [a, b] = [p(process.argv[1]), p(process.argv[2])];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) { console.log(a[i] > b[i]); process.exit(); }
  console.log(false);' "$next" "$current")"
[[ "$greater" == true ]] || die "$next is not greater than $current"
tag="v$next"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists locally"
if [[ "$local_only" == false ]] && git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  die "tag $tag already exists on origin"
fi

# ── 3. bump ──────────────────────────────────────────────────────────────────
npm --prefix daemon version --no-git-tag-version --allow-same-version "$next" >/dev/null
sed -i '' "s/^\( *MARKETING_VERSION: *\)\"$current\"/\1\"$next\"/" ios/project.yml
[[ "$(sed -n 's/^ *MARKETING_VERSION: *"\([^"]*\)".*/\1/p' ios/project.yml | sort -u)" == "$next" ]] ||
  die "failed to set MARKETING_VERSION to $next in ios/project.yml"

# ── 4. changelog ─────────────────────────────────────────────────────────────
node -e '
  const fs = require("fs");
  const [version, date] = process.argv.slice(1);
  let log = fs.readFileSync("CHANGELOG.md", "utf8");
  const start = log.indexOf("## [Unreleased]");
  if (start < 0) throw new Error("CHANGELOG.md has no ## [Unreleased] section");
  const bodyStart = start + "## [Unreleased]".length;
  const next = log.indexOf("\n## [", bodyStart);
  let body = (next < 0 ? log.slice(bodyStart) : log.slice(bodyStart, next)).trim();
  if (!body) body = "- No changes; released with the train.";
  const section = `## [Unreleased]\n\n## [${version}] - ${date}\n\n${body}\n`;
  log = log.slice(0, start) + section + (next < 0 ? "" : log.slice(next));
  fs.writeFileSync("CHANGELOG.md", log);' "$next" "$(date +%Y-%m-%d)"

# ── 5. commit and tag ────────────────────────────────────────────────────────
git add daemon/package.json daemon/package-lock.json ios/project.yml CHANGELOG.md
git commit --quiet -m "Release $tag"
git tag -a "$tag" -m "$tag"

cat <<EOF

Created commit and tag $tag locally. NOT pushed.

  1) git push origin main       # daemon + web → dev (wait for green); Dev app build
  2) git push origin $tag        # daemon + web → test; iOS Test build → TestFlight

Never use --follow-tags: it would start the dev and test deploys at once on the box.
Then attach What to Test notes to the processed iOS build (ios/TESTFLIGHT.md).
EOF
