#!/usr/bin/env bash
# Cut a Celiador release: the daemon is the release train (ENVIRONMENTS.md).
#
#   scripts/release.sh <X.Y.Z | major | minor | patch> [--local]
#
#   X.Y.Z               the exact version to release
#   major/minor/patch   bump from the current version
#   --local             skip the origin checks (rehearsals only)
#
# What it does, in order, refusing at the first problem:
#   1. clean main, equal to origin/main
#   2. the new version is greater, and its tag does not exist yet
#   3. bump package.json + package-lock.json (npm version, no git tag)
#   4. roll CHANGELOG.md: "## [Unreleased]" becomes "## [X.Y.Z] - <date>"
#   5. commit "Release vX.Y.Z" and create an annotated tag
#
# It never pushes. Then, in two stages (RELEASING.md):
#   git push origin main        # deploys dev — wait for the run to go green
#   git push origin vX.Y.Z      # deploys test
# Never --follow-tags: both deploys would run at once on the same box.
#
# Below 1.0.0 the usual 0.x convention applies: a breaking client-facing change
# (docs/CLIENT_INTEGRATION.md) is a MINOR bump, additive changes and fixes are
# PATCH releases. Going to 1.0.0 is a deliberate decision.
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
current="$(node -p "require('./package.json').version")"
[[ "$current" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || die "package.json version '$current' is not X.Y.Z"
major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"
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
npm version --no-git-tag-version --allow-same-version "$next" >/dev/null

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
git add package.json package-lock.json CHANGELOG.md
git commit --quiet -m "Release $tag"
git tag -a "$tag" -m "$tag"

cat <<EOF

Created commit and tag $tag locally. NOT pushed.

  1) git push origin main       # deploys dev — wait for the run to go green
  2) git push origin $tag        # then deploys test

Never use --follow-tags: it would start the dev and test deploys at once on the box.
EOF
