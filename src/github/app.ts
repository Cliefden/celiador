import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { ROOT } from "../config";
import type { TaskRepo } from "../tasks/store";

/**
 * The Celiador GitHub App: the daemon's own GitHub identity.
 *
 * Created once through GitHub's app-manifest flow — `GET /api/github/app/new`
 * renders a form that takes the org owner to github.com with the manifest,
 * GitHub redirects back to `GET /api/github/app/setup?code=…`, and the daemon
 * exchanges the code for the app's id, private key and webhook secret, which it
 * keeps in `data/github-app.json` (mode 0600). No credential is typed anywhere.
 *
 * With the app installed on the org:
 * - its webhook replaces per-repo webhooks (same handler; the app's secret is
 *   accepted alongside CELIADOR_GITHUB_WEBHOOK_SECRET);
 * - the daemon comments on issues as "Celiador" (picked up / failed), so the
 *   editor's own gh-token comment is only a fallback;
 * - the sandbox runner clones private repos with a short-lived installation token.
 */

export interface GitHubAppCredentials {
  readonly id: number;
  readonly slug: string;
  readonly name: string;
  readonly htmlUrl: string;
  readonly pem: string;
  readonly webhookSecret: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly createdAt: string;
}

const FILE = path.join(ROOT, "data", "github-app.json");
const GITHUB_API = "https://api.github.com";
const USER_AGENT = "celiador-daemon";
/** Where the daemon is reachable from GitHub (webhook + setup redirect). */
export const PUBLIC_URL = (process.env.CELIADOR_PUBLIC_URL ?? "https://celiador.ai").replace(/\/+$/, "");
/** The GitHub organization the app is created under. */
const ORG = process.env.CELIADOR_GITHUB_ORG ?? "Cliefden";

let cached: GitHubAppCredentials | null | undefined;

/** The stored app, or null until the setup flow has run. */
export function githubApp(): GitHubAppCredentials | null {
  if (cached !== undefined) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as GitHubAppCredentials;
    cached = typeof raw.id === "number" && typeof raw.pem === "string" ? raw : null;
  } catch {
    cached = null;
  }
  return cached;
}

function saveApp(app: GitHubAppCredentials): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(app, null, 2), { mode: 0o600 });
  cached = app;
}

/** Test seam: forget the stored app (and optionally install a fake one). */
export function resetGitHubAppForTests(app?: GitHubAppCredentials): void {
  cached = app ?? null;
  tokens.clear();
}

function b64url(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}

/** A 10-minute app JWT (RS256), the credential for app-level API calls. */
export function appJwt(app: GitHubAppCredentials, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: app.id }));
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), app.pem);
  return `${header}.${payload}.${b64url(signature)}`;
}

async function api(token: string, method: string, pathname: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${GITHUB_API}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      "x-github-api-version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** Installation tokens by repo (`owner/name`), good for an hour; reused for 50 minutes. */
const tokens = new Map<string, { token: string; expiresAt: number }>();

const BASE_PERMISSIONS = { contents: "write", issues: "write", pull_requests: "write", metadata: "read" };
/** Read-only CI state for the queue's checks badge. Added later: older installations may not have approved it. */
const CI_PERMISSIONS = { checks: "read", statuses: "read" };

/**
 * A short-lived installation token for `repo`, or null when the app is not set
 * up or not installed on that repo. The token can read contents and write
 * issues / pull requests on the repos the installation covers, plus read
 * checks and commit statuses when the installation has approved those (an
 * installation that hasn't answers 422 to asking — then the token goes without,
 * and the checks badge reads "unknown").
 */
export async function installationToken(repo: Pick<TaskRepo, "owner" | "name">): Promise<string | null> {
  const app = githubApp();
  if (!app) return null;
  const key = `${repo.owner}/${repo.name}`.toLowerCase();
  const hit = tokens.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  const jwt = appJwt(app);
  const inst = await api(jwt, "GET", `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/installation`);
  if (inst.status !== 200 || typeof inst.json?.id !== "number") return null;
  const request = (permissions: Record<string, string>) =>
    api(jwt, "POST", `/app/installations/${inst.json.id}/access_tokens`, { repositories: [repo.name], permissions });
  let created = await request({ ...BASE_PERMISSIONS, ...CI_PERMISSIONS });
  if (created.status === 422) created = await request(BASE_PERMISSIONS);
  if (created.status !== 201 || typeof created.json?.token !== "string") return null;
  tokens.set(key, { token: created.json.token, expiresAt: Date.now() + 50 * 60_000 });
  return created.json.token;
}

/**
 * One REST call on `repo` as the app (installation token). Null when the app
 * isn't set up or isn't installed there — callers fall back to the editor.
 */
export async function appRequest(
  repo: Pick<TaskRepo, "owner" | "name">,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<{ status: number; json: any } | null> {
  const token = await installationToken(repo);
  if (!token) return null;
  return api(token, method, `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}${pathname}`, body);
}

/** Comment on an issue as the app. False when the app is absent or not installed there. */
export async function commentOnIssue(repo: Pick<TaskRepo, "owner" | "name">, issueNumber: number, body: string): Promise<boolean> {
  const res = await appRequest(repo, "POST", `/issues/${issueNumber}/comments`, { body });
  return res?.status === 201;
}

// ---- Setup flow (manifest) --------------------------------------------------

/** One-time states handed to GitHub with the manifest, so a stray redirect can't register an app. */
const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 15 * 60_000;

function newState(): string {
  for (const [s, exp] of pendingStates) if (exp < Date.now()) pendingStates.delete(s);
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now() + STATE_TTL_MS);
  return state;
}

/** The app as GitHub's manifest flow wants it. Exported for the smoke test. */
export function appManifest(): Record<string, unknown> {
  return {
    name: "Celiador",
    url: "https://celiador.ai",
    description: "Issue in, pull request out. Label an issue `celiador` and an agent runs it in its own worktree and opens a pull request you review from your phone.",
    hook_attributes: { url: `${PUBLIC_URL}/api/github/webhook`, active: true },
    redirect_url: `${PUBLIC_URL}/api/github/app/setup`,
    public: false,
    default_permissions: { issues: "write", pull_requests: "write", contents: "write", metadata: "read", checks: "read", statuses: "read" },
    default_events: ["issues", "issue_comment", "pull_request", "check_suite", "status"],
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The daemon's small dark HTML page (setup flow, deep-link pages). `head` is extra markup for <head>. */
export function page(title: string, body: string, head = ""): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>${head}<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;background:#0E1113;color:#E8ECEA;margin:0;padding:48px 24px}main{max-width:560px;margin:0 auto}h1{font-size:24px}a{color:#7FD1AE}button{font:inherit;background:#7FD1AE;color:#0B1A13;border:0;border-radius:10px;padding:12px 18px;font-weight:600;cursor:pointer}code{background:#171B1E;padding:2px 6px;border-radius:4px}</style></head><body><main>${body}</main></body></html>`;
}

/**
 * `/api/github/app/*` — the manifest flow. Unauthenticated on purpose: it only
 * works for someone who can create apps in the org (GitHub enforces that), the
 * manifest carries no secret, and the redirect is bound to a one-time state.
 */
export function githubAppRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/new", (c) => {
    const existing = githubApp();
    if (existing) {
      return c.html(page("Celiador GitHub App", `<h1>Already set up</h1><p>The app <a href="${escapeHtml(existing.htmlUrl)}">${escapeHtml(existing.name)}</a> is registered. Install it on more repositories from <a href="${escapeHtml(existing.htmlUrl)}/installations/new">its install page</a>.</p>`));
    }
    const state = newState();
    const action = `https://github.com/organizations/${encodeURIComponent(ORG)}/settings/apps/new?state=${state}`;
    const manifest = escapeHtml(JSON.stringify(appManifest()));
    return c.html(page("Create the Celiador GitHub App", `<h1>Create the Celiador GitHub App</h1><p>This takes you to GitHub with the app's manifest filled in (webhook, permissions, events). Only an owner of <code>${escapeHtml(ORG)}</code> can create it. GitHub then sends you back here and the daemon stores the app's credentials itself.</p><form method="post" action="${escapeHtml(action)}"><input type="hidden" name="manifest" value="${manifest}"><button type="submit">Continue to GitHub</button></form><p><small>Permissions: issues and pull requests (write), contents (write, for private-repo clones and pushes), metadata, checks and commit statuses (read). Events: issues, issue comments, pull requests, check suites, statuses.</small></p>`));
  });

  app.get("/setup", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state || !pendingStates.has(state)) {
      return c.html(page("Celiador GitHub App", `<h1>That link has expired</h1><p>Start again from <a href="${escapeHtml(PUBLIC_URL)}/api/github/app/new">the setup page</a>.</p>`), 400);
    }
    pendingStates.delete(state);
    const res = await fetch(`${GITHUB_API}/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST",
      headers: { accept: "application/vnd.github+json", "user-agent": USER_AGENT, "x-github-api-version": "2022-11-28" },
    });
    const json: any = await res.json().catch(() => ({}));
    if (res.status !== 201 || typeof json?.id !== "number" || typeof json?.pem !== "string") {
      return c.html(page("Celiador GitHub App", `<h1>GitHub did not return an app</h1><p>Status ${res.status}: <code>${escapeHtml(String(json?.message ?? "no details"))}</code>. Start again from <a href="${escapeHtml(PUBLIC_URL)}/api/github/app/new">the setup page</a>.</p>`), 502);
    }
    const created: GitHubAppCredentials = {
      id: json.id,
      slug: String(json.slug ?? ""),
      name: String(json.name ?? "Celiador"),
      htmlUrl: String(json.html_url ?? `https://github.com/apps/${json.slug ?? ""}`),
      pem: json.pem,
      webhookSecret: String(json.webhook_secret ?? ""),
      clientId: String(json.client_id ?? ""),
      clientSecret: String(json.client_secret ?? ""),
      createdAt: new Date().toISOString(),
    };
    saveApp(created);
    return c.html(page("Celiador GitHub App", `<h1>Done</h1><p>The app <a href="${escapeHtml(created.htmlUrl)}">${escapeHtml(created.name)}</a> is registered and its credentials are stored on the daemon.</p><p>Last step: <a href="${escapeHtml(created.htmlUrl)}/installations/new">install it on the organization</a> and pick the repositories agents may work on. From then on the app's webhook feeds the queue, the daemon comments on issues as ${escapeHtml(created.name)}, and cloud runs can clone private repositories. The per-repository webhooks can be removed.</p>`));
  });

  return app;
}
