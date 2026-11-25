#!/usr/bin/env node
// Rolls CHANGELOG.md for a release: the fragments in changes/unreleased/, newest
// issue first, then anything still under ## [Unreleased], become the new version's
// section. The fragments are deleted. See changes/README.md. (Celindor's
// scripts/changelog-roll.mjs, without its API-changes section.)
//
//   node scripts/changelog-roll.mjs <version> <date>
//   node scripts/changelog-roll.mjs --check
//
// --check only validates the fragments and changes nothing. CI runs it, and
// release.sh runs it before bumping anything, so a bad fragment can't stop a
// release halfway.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const check = process.argv[2] === "--check";
const [version, date] = process.argv.slice(2);
if (!check && (!version || !date)) {
  throw new Error("usage: changelog-roll.mjs <version> <date> | --check");
}

const dir = join("changes", "unreleased");
const issue = (name) => Number.parseInt(name, 10) || 0;
const names = existsSync(dir)
  ? readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort((a, b) => issue(b) - issue(a) || a.localeCompare(b))
  : [];

// A fragment starts with "### Title (#NNN)" or "### Title (#MMM, #NNN)", one of
// the issues being its file's.
const problem = (name, text) => {
  if (!/^\d+-.+\.md$/.test(name)) return 'the name must be "<issue#>-<slug>.md"';
  const heading = /^### \S.* \((#\d+(?:, #\d+)*)\)$/.exec(text.split("\n", 1)[0]);
  if (!heading) return 'it must start with a "### Title (#NNN)" heading';
  if (!heading[1].split(", ").includes(`#${issue(name)}`)) return `its heading must list #${issue(name)}, the file's issue`;
  return null;
};

const fragments = names.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8").trim() }));
const bad = fragments
  .map(({ name, text }) => ({ name, why: problem(name, text) }))
  .filter(({ why }) => why);
if (bad.length) {
  for (const { name, why } of bad) console.error(`${join(dir, name)}: ${why}`);
  console.error("See changes/README.md for the format.");
  process.exit(1);
}
if (check) {
  console.log(`${names.length} changelog fragments OK`);
  process.exit(0);
}

const log = readFileSync("CHANGELOG.md", "utf8");
const heading = "## [Unreleased]";
const start = log.indexOf(heading);
if (start < 0) throw new Error("CHANGELOG.md has no ## [Unreleased] section");
const bodyStart = start + heading.length;
const next = log.indexOf("\n## [", bodyStart);
const unreleased = (next < 0 ? log.slice(bodyStart) : log.slice(bodyStart, next)).trim();

let body = [...fragments.map(({ text }) => text), unreleased].filter(Boolean).join("\n\n");
if (!body) body = "- No changes; released with the train.";

const section = `${heading}\n\n## [${version}] - ${date}\n\n${body}\n`;
writeFileSync("CHANGELOG.md", log.slice(0, start) + section + (next < 0 ? "" : log.slice(next)));
for (const name of names) rmSync(join(dir, name));
