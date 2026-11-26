/**
 * The API contract covers what the daemon serves (#161).
 *
 * Builds the real `createApp()` app, lists every route it registers under
 * `/api`, and compares that with the operations in
 * `packages/client/openapi.yaml`. Fails when
 *   - the daemon serves a route the spec doesn't describe (and it isn't in
 *     `packages/client/routes-allowlist.txt`),
 *   - the spec describes a route the daemon doesn't serve,
 *   - the allowlist names a route that is now in the spec, or no longer served.
 * Path parameters are compared by position only (`:rid` matches `{requestId}`).
 * Run: `npm run check:api-coverage` (in daemon/).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Env the daemon modules read at import time → dynamic import below.
const HOME = path.join(os.tmpdir(), `celiador-api-coverage-${process.pid}`);
process.env.SUPABASE_JWT_SECRET ??= "coverage-secret";
process.env.ANTHROPIC_API_KEY ??= "sk-coverage";
process.env.CELIADOR_HOME = HOME;
process.env.CELIADOR_RELEASES_DIR = path.join(HOME, "releases");

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, "../../packages/client");
const SPEC = path.join(clientDir, "openapi.yaml");
const ALLOWLIST = path.join(clientDir, "routes-allowlist.txt");
const METHODS = ["get", "put", "post", "delete", "patch", "head", "options"];

/** `GET /api/sessions/{}/approvals/{}` — parameters by position only. */
function key(method: string, p: string): string {
  const shape = p
    .replace(/\{[^}]+\}/g, "{}")
    .replace(/:[A-Za-z0-9_]+(\{[^}]*\})?/g, "{}")
    .replace(/\/+$/, "");
  return `${method.toUpperCase()} ${shape || "/"}`;
}

/** The operations in the spec, read straight from the YAML's two-level layout. */
function specOperations(): Set<string> {
  const ops = new Set<string>();
  let current: string | undefined;
  let inPaths = false;
  for (const line of fs.readFileSync(SPEC, "utf8").split("\n")) {
    if (/^\S/.test(line)) { inPaths = line.startsWith("paths:"); current = undefined; continue; }
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) { current = p[1]!.replace(/^"|"$/g, ""); continue; }
    const m = /^ {4}([a-z]+):/.exec(line);
    if (current && m && METHODS.includes(m[1]!)) ops.add(key(m[1]!, current));
  }
  return ops;
}

function allowlist(): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(ALLOWLIST)) return out;
  for (const raw of fs.readFileSync(ALLOWLIST, "utf8").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [method, p] = line.split(/\s+/);
    if (!method || !p) throw new Error(`routes-allowlist.txt: can't read "${raw}" (want "METHOD /api/path")`);
    out.set(key(method, p), raw.trim());
  }
  return out;
}

async function main(): Promise<number> {
  fs.mkdirSync(HOME, { recursive: true });
  const { createApp } = await import("../src/app.ts");
  const app = createApp();

  const served = new Set<string>();
  for (const r of app.routes) {
    if (r.method === "ALL" || !r.path.startsWith("/api/")) continue; // middleware
    if (r.path.includes("*")) continue;
    served.add(key(r.method, r.path));
  }
  const spec = specOperations();
  const allowed = allowlist();

  const undocumented = [...served].filter((k) => !spec.has(k) && !allowed.has(k)).sort();
  const unserved = [...spec].filter((k) => !served.has(k)).sort();
  const staleAllow = [...allowed.entries()].filter(([k]) => spec.has(k) || !served.has(k)).map(([, raw]) => raw);

  console.log(`${served.size} routes served under /api, ${spec.size} operations in openapi.yaml, ${allowed.size} allowlisted.`);
  const report = (title: string, items: string[]): void => {
    if (!items.length) return;
    console.log(`\n${title}`);
    for (const i of items) console.log(`  ${i}`);
  };
  report("Served but not in packages/client/openapi.yaml — document them (or, if they are not for clients, add them to routes-allowlist.txt):", undocumented);
  report("In openapi.yaml but not served by the daemon — remove them from the spec only with a MINOR release (below 1.0), they are breaking:", unserved);
  report("routes-allowlist.txt entries that are documented now or no longer served — remove them:", staleAllow);
  const failed = undocumented.length + unserved.length + staleAllow.length;
  console.log(failed ? `\nAPI coverage: ${failed} problem(s).` : "API coverage: every route is in the contract.");
  return failed ? 1 : 0;
}

main()
  .then((code) => { fs.rmSync(HOME, { recursive: true, force: true }); process.exit(code); })
  .catch((err) => { console.error(err); process.exit(1); });
