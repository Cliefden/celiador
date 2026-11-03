import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import type { AppEnv } from "../auth";
import { requireUser } from "../auth";
import { ROOT } from "../config";
import { taskStores } from "../tasks/dispatch";
import type { RepoLinkProof, TaskRepo } from "../tasks/store";
import { appInstalledOn, escapeHtml, githubApp, page, PUBLIC_URL } from "./app";

/**
 * Proof of access before the Celiador GitHub App acts on a repo (#79).
 *
 * The App's installation token can read, push, open and merge on every repo the
 * installation covers, so "linked to this Celiador user" is not enough to hand
 * it out — the first user to link another org's repo would get it. Instead:
 *
 * 1. The user connects their GitHub account through the App's own user
 *    authorization (OAuth for GitHub Apps): `POST /api/github/account/connect`
 *    hands the client a github.com URL bound to a one-time state; GitHub sends
 *    the browser back to `GET /api/github/callback`, which redeems the code and
 *    asks the browser to confirm "connect @login to <Celiador email>" (so a
 *    connect link sent by someone else can't silently bind the victim's GitHub
 *    account to the sender's Celiador account). One GitHub account belongs to
 *    one Celiador account.
 * 2. Linking a repo checks, with that user-to-server token, that GitHub says the
 *    user has write (push / maintain / admin) access to it. The proof is stored on
 *    the link (tasks/store.ts RepoLinkProof).
 * 3. Every installation-token use (github/app.ts installationToken) requires the
 *    acting user to own the repo's link *with* a proof, and re-checks the proof
 *    with GitHub once it is older than CELIADOR_GITHUB_VERIFY_TTL_MS (default
 *    1 h). Lost access, a revoked authorization or a different repo behind the
 *    same name drops the proof; a GitHub outage only refuses for now.
 *
 * Links without a proof (all links made before this change, and links by users
 * who never connected GitHub) keep working for what needs no App: issue routing
 * for public repos, editor runs, anonymous clones of public repos. They never get
 * the token until the owner connects GitHub, which re-verifies all their links.
 *
 * The user-to-server tokens (and refresh tokens) are kept in
 * data/github-identities.json, mode 0600, like the App's own key.
 */

const FILE = path.join(ROOT, "data", "github-identities.json");
const GITHUB_API = "https://api.github.com";
const GITHUB_WEB = "https://github.com";
const USER_AGENT = "celiador-daemon";
/** Connect links and confirm pages expire after this. */
const FLOW_TTL_MS = 10 * 60_000;

/** How long a link's proof is trusted before GitHub is asked again. */
export function verifyTtlMs(): number {
  const n = Number(process.env.CELIADOR_GITHUB_VERIFY_TTL_MS ?? 60 * 60_000);
  return Number.isFinite(n) && n >= 0 ? n : 60 * 60_000;
}

export interface GitHubIdentity {
  readonly githubId: number;
  readonly login: string;
  readonly accessToken: string;
  /** Epoch ms; absent when the App issues non-expiring user tokens. */
  readonly accessExpiresAt?: number;
  readonly refreshToken?: string;
  readonly refreshExpiresAt?: number;
  readonly connectedAt: string;
}

// ---- Identity store ----------------------------------------------------------

let identities: Record<string, GitHubIdentity> | undefined;

function load(): Record<string, GitHubIdentity> {
  if (identities) return identities;
  try {
    identities = JSON.parse(fs.readFileSync(FILE, "utf8")) as Record<string, GitHubIdentity>;
  } catch {
    identities = {};
  }
  return identities;
}

function save(): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(load()), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

export function githubIdentity(userId: string): GitHubIdentity | undefined {
  return load()[userId];
}

function setIdentity(userId: string, identity: GitHubIdentity | undefined): void {
  const all = load();
  if (identity) all[userId] = identity;
  else delete all[userId];
  save();
}

/** The Celiador user a GitHub account is connected to, if any. */
function userForGitHubId(githubId: number): string | undefined {
  return Object.entries(load()).find(([, id]) => id.githubId === githubId)?.[0];
}

/** Drop the proofs on all of a user's links (disconnect, or a different GitHub account). */
function clearProofs(userId: string): void {
  for (const link of taskStores.links.detailedForUser(userId)) {
    if (link.verified) taskStores.links.setProof(userId, link.url, undefined);
  }
}

/** Account deletion / disconnect: forget the identity (best-effort revoke at GitHub). */
export async function disconnectGitHub(userId: string): Promise<void> {
  const identity = githubIdentity(userId);
  clearProofs(userId);
  if (!identity) return;
  setIdentity(userId, undefined);
  const app = githubApp();
  if (!app?.clientId || !app.clientSecret) return;
  await fetch(`${GITHUB_API}/applications/${encodeURIComponent(app.clientId)}/grant`, {
    method: "DELETE",
    headers: {
      authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({ access_token: identity.accessToken }),
  }).catch(() => undefined);
}

/** Test seam: install (or remove) a connected identity without the OAuth round trip, and forget pending flows. */
export function setGitHubIdentityForTests(userId: string, identity: GitHubIdentity | undefined): void {
  setIdentity(userId, identity);
  if (!identity) clearProofs(userId);
}
export function resetGitHubAccessForTests(): void {
  pendingStates.clear();
  pendingConfirms.clear();
  refreshing.clear();
  reverifying.clear();
}

// ---- GitHub calls with the user's token ------------------------------------

async function oauthToken(params: Record<string, string>): Promise<{ ok: true; identity: Omit<GitHubIdentity, "githubId" | "login" | "connectedAt"> } | { ok: false; error: string }> {
  const app = githubApp();
  if (!app?.clientId || !app.clientSecret) return { ok: false, error: "the GitHub App has no OAuth client credentials" };
  const res = await fetch(`${GITHUB_WEB}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": USER_AGENT },
    body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, ...params }),
  }).catch(() => null);
  const json: any = res ? await res.json().catch(() => ({})) : {};
  if (!res || res.status !== 200 || typeof json?.access_token !== "string") {
    return { ok: false, error: String(json?.error_description ?? json?.error ?? `GitHub answered ${res?.status ?? "nothing"}`) };
  }
  const now = Date.now();
  const secs = (v: unknown) => (typeof v === "number" && v > 0 ? now + v * 1000 : undefined);
  return {
    ok: true,
    identity: {
      accessToken: json.access_token,
      accessExpiresAt: secs(json.expires_in),
      refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : undefined,
      refreshExpiresAt: secs(json.refresh_token_expires_in),
    },
  };
}

async function userApi(token: string, pathname: string): Promise<{ status: number; json: any } | null> {
  const res = await fetch(`${GITHUB_API}${pathname}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": USER_AGENT, "x-github-api-version": "2022-11-28" },
  }).catch(() => null);
  if (!res) return null;
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/** Refreshes per user in flight: refresh tokens are single-use, so two at once would burn the grant. */
const refreshing = new Map<string, Promise<string | null>>();

/** The user's current user-to-server token, refreshed when it has (nearly) expired. Null: reconnect needed. */
async function userToken(userId: string, force = false): Promise<string | null> {
  const identity = githubIdentity(userId);
  if (!identity) return null;
  const fresh = !identity.accessExpiresAt || identity.accessExpiresAt - 60_000 > Date.now();
  if (fresh && !force) return identity.accessToken;
  // Expired (or refused with a 401) and nothing to refresh with: the user has to connect again.
  if (!identity.refreshToken || (identity.refreshExpiresAt && identity.refreshExpiresAt < Date.now())) return null;
  const running = refreshing.get(userId);
  if (running) return running;
  const p = (async () => {
    const r = await oauthToken({ grant_type: "refresh_token", refresh_token: identity.refreshToken! });
    if (!r.ok) return null;
    const current = githubIdentity(userId);
    if (!current || current.githubId !== identity.githubId) return null;
    setIdentity(userId, { ...current, ...r.identity, refreshToken: r.identity.refreshToken ?? current.refreshToken });
    return r.identity.accessToken;
  })().finally(() => refreshing.delete(userId));
  refreshing.set(userId, p);
  return p;
}

export type ProofResult =
  | { ok: true; proof: RepoLinkProof }
  | { ok: false; reason: "no-app" | "not-connected" | "reconnect" | "no-access" | "unavailable"; message: string };

function refusal(reason: Exclude<ProofResult, { ok: true }>["reason"], repo: Pick<TaskRepo, "owner" | "name">, login?: string): Exclude<ProofResult, { ok: true }> {
  const full = `${repo.owner}/${repo.name}`;
  const message = {
    "no-app": "the Celiador GitHub App isn't set up on this server",
    "not-connected": `connect your GitHub account in Celiador to link ${full}: the daemon checks that you can write to it before the Celiador GitHub App works on it for you`,
    reconnect: "your GitHub connection has expired or was revoked; connect your GitHub account again",
    "no-access": `GitHub says ${login ? `@${login}` : "your GitHub account"} can't write to ${full} (or can't see it through the Celiador GitHub App)`,
    unavailable: "couldn't check your access with GitHub right now; try again in a moment",
  }[reason];
  return { ok: false, reason, message };
}

/**
 * Ask GitHub, as the user, whether they can write to `repo`. A user-to-server
 * token only sees repos the App's installations cover *and* the user can access,
 * and GitHub reports the user's own permission on each — exactly the proof the
 * installation token needs.
 */
export async function verifyRepoAccess(userId: string, repo: Pick<TaskRepo, "owner" | "name">): Promise<ProofResult> {
  if (!githubApp()) return refusal("no-app", repo);
  const identity = githubIdentity(userId);
  if (!identity) return refusal("not-connected", repo);
  const pathname = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  let token = await userToken(userId);
  if (!token) return refusal("reconnect", repo, identity.login);
  let res = await userApi(token, pathname);
  if (res?.status === 401) {
    token = await userToken(userId, true);
    if (!token) return refusal("reconnect", repo, identity.login);
    res = await userApi(token, pathname);
    if (res?.status === 401) return refusal("reconnect", repo, identity.login);
  }
  if (!res || res.status >= 500 || res.status === 429) return refusal("unavailable", repo, identity.login);
  if (res.status !== 200) return refusal("no-access", repo, identity.login);
  const json = res.json ?? {};
  // A redirect (renamed / transferred repo) lands on another name: that's not the repo that was asked about.
  if (typeof json.full_name !== "string" || json.full_name.toLowerCase() !== `${repo.owner}/${repo.name}`.toLowerCase() || typeof json.id !== "number") {
    return refusal("no-access", repo, identity.login);
  }
  const perms = json.permissions ?? {};
  const permission = perms.admin === true ? "admin" : perms.maintain === true ? "maintain" : perms.push === true ? "push" : undefined;
  if (!permission) return refusal("no-access", repo, identity.login);
  return { ok: true, proof: { githubId: identity.githubId, login: identity.login, repoId: json.id, permission, at: new Date().toISOString() } };
}

const ghUrl = (repo: Pick<TaskRepo, "owner" | "name">) => `https://github.com/${repo.owner}/${repo.name}`;

/** Whether the user's link to the repo carries a proof (sync; may be due for a re-check). */
export function hasProvenLink(userId: string, url: string): boolean {
  const link = taskStores.links.get(url);
  return !!link && link.userId === userId && !!link.verified;
}

/** Re-checks in flight per user + repo, so a burst of App calls asks GitHub once. */
const reverifying = new Map<string, Promise<ProofResult>>();

/**
 * The gate in front of every installation token: may the App act on `repo` for
 * this user? Yes only for their own link with a proof from their currently
 * connected GitHub account, re-checked with GitHub when older than the TTL.
 */
export async function appMayActFor(userId: string, repo: Pick<TaskRepo, "owner" | "name">): Promise<boolean> {
  const url = ghUrl(repo);
  const link = taskStores.links.get(url);
  if (!link || link.userId !== userId || !link.verified) return false;
  const identity = githubIdentity(userId);
  if (!identity || identity.githubId !== link.verified.githubId) {
    taskStores.links.setProof(userId, url, undefined);
    return false;
  }
  if (Date.now() - Date.parse(link.verified.at) < verifyTtlMs()) return true;
  const key = `${userId}:${url.toLowerCase()}`;
  let check = reverifying.get(key);
  if (!check) {
    check = verifyRepoAccess(userId, repo).finally(() => reverifying.delete(key));
    reverifying.set(key, check);
  }
  const r = await check;
  if (r.ok && r.proof.repoId === link.verified.repoId) {
    taskStores.links.setProof(userId, url, r.proof);
    return true;
  }
  // Lost access, revoked authorization, or a different repo under the same name: the proof goes.
  // GitHub unreachable: refuse for now, keep the proof for the next try.
  if (r.ok || r.reason !== "unavailable") taskStores.links.setProof(userId, url, undefined);
  return false;
}

/**
 * `POST /api/tasks/repos`: link a repo, with a proof when the user's GitHub
 * account can write to it. Without one, a repo the App is installed on is
 * refused (that's where the token would matter, and a first-come claim would
 * block its real owner); any other repo is linked without proof, as before.
 */
export async function linkRepo(userId: string, repo: TaskRepo): Promise<
  | { ok: true; verified: boolean; message?: string }
  | { ok: false; status: 403 | 409 | 503; error: string; needs?: "github-connect" | "write-access" }
> {
  const existing = taskStores.links.get(repo.url);
  if (existing && existing.userId !== userId && existing.verified) return { ok: false, status: 409, error: "this repo is linked to another account" };
  const r = await verifyRepoAccess(userId, repo);
  if (r.ok) {
    if (taskStores.links.link(userId, repo.url, r.proof) === "taken") return { ok: false, status: 409, error: "this repo is linked to another account" };
    return { ok: true, verified: true };
  }
  if (existing && existing.userId !== userId) return { ok: false, status: 409, error: "this repo is linked to another account" };
  if (existing) {
    // Already theirs: keep the link; a definite "no" drops a stale proof.
    if (r.reason === "no-access" || r.reason === "reconnect" || r.reason === "not-connected") taskStores.links.setProof(userId, repo.url, undefined);
    return { ok: true, verified: hasProvenLink(userId, repo.url), message: r.reason === "no-app" ? undefined : r.message };
  }
  if (r.reason !== "no-app" && (await appInstalledOn(repo))) {
    if (r.reason === "unavailable") return { ok: false, status: 503, error: r.message };
    return { ok: false, status: 403, error: r.message, needs: r.reason === "no-access" ? "write-access" : "github-connect" };
  }
  taskStores.links.link(userId, repo.url);
  return { ok: true, verified: false, message: r.reason === "no-app" ? undefined : r.message };
}

/** Re-verify every link of a user (after connecting GitHub). Returns how many now carry a proof. */
async function verifyAllLinks(userId: string): Promise<{ verified: number; total: number }> {
  const links = taskStores.links.detailedForUser(userId);
  let verified = 0;
  await Promise.all(links.map(async (link) => {
    const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(link.url);
    if (!m) return;
    const r = await verifyRepoAccess(userId, { owner: m[1]!, name: m[2]! });
    if (r.ok) {
      taskStores.links.setProof(userId, link.url, r.proof);
      verified++;
    } else if (r.reason !== "unavailable") taskStores.links.setProof(userId, link.url, undefined);
  }));
  return { verified, total: links.length };
}

// ---- Connect flow ----------------------------------------------------------

/** One-time states for the GitHub round trip: state → the Celiador user who started it. */
const pendingStates = new Map<string, { userId: string; email?: string; exp: number }>();
/** Redeemed codes waiting for the browser's "connect" click. */
const pendingConfirms = new Map<string, { userId: string; email?: string; identity: GitHubIdentity; exp: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [k, v] of pendingStates) if (v.exp < now) pendingStates.delete(k);
  for (const [k, v] of pendingConfirms) if (v.exp < now) pendingConfirms.delete(k);
}

/** Headers for the flow's pages: never framed (the confirm button), never cached, no Referer with the code. */
function guard(res: Response): Response {
  res.headers.set("x-frame-options", "DENY");
  res.headers.set("content-security-policy", "frame-ancestors 'none'");
  res.headers.set("cache-control", "no-store");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}

/** `/api/github/account` (signed in): the user's GitHub connection. */
export function githubAccountRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser);

  app.get("/", (c) => {
    const identity = githubIdentity(c.get("user").userId);
    const gh = githubApp();
    return c.json({
      app: !!gh?.clientId,
      connected: !!identity,
      ...(identity ? { login: identity.login, connectedAt: identity.connectedAt } : {}),
    });
  });

  // The URLs the client opens in a browser: authorize only, or install the App (and authorize) in one go.
  app.post("/connect", (c) => {
    const gh = githubApp();
    if (!gh?.clientId) return c.json({ error: "the Celiador GitHub App isn't set up on this server" }, 503);
    sweep();
    const user = c.get("user");
    const state = crypto.randomBytes(24).toString("base64url");
    pendingStates.set(state, { userId: user.userId, email: user.email, exp: Date.now() + FLOW_TTL_MS });
    const redirect = `${PUBLIC_URL}/api/github/callback`;
    const authorizeUrl = `${GITHUB_WEB}/login/oauth/authorize?client_id=${encodeURIComponent(gh.clientId)}&redirect_uri=${encodeURIComponent(redirect)}&state=${state}`;
    const installUrl = `${gh.htmlUrl}/installations/new?state=${state}`;
    return c.json({ authorizeUrl, installUrl, expiresIn: Math.floor(FLOW_TTL_MS / 1000) });
  });

  app.delete("/", async (c) => {
    await disconnectGitHub(c.get("user").userId);
    return c.json({ ok: true, connected: false });
  });

  return app;
}

/** `/api/github/callback` (no auth: the browser comes from github.com): redeem, confirm, store. */
export function githubCallbackRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const done = (title: string, html: string, status: 200 | 400 | 409 | 502 = 200) =>
    guard(new Response(page(title, html), { status, headers: { "content-type": "text/html; charset=utf-8" } }));

  app.get("/", async (c) => {
    sweep();
    const code = c.req.query("code");
    const state = c.req.query("state");
    const pending = state ? pendingStates.get(state) : undefined;
    if (!code || !pending) {
      // Installed from GitHub's own page (no Celiador state), or a stale / foreign link: redeem nothing.
      const installed = c.req.query("setup_action") === "install" || c.req.query("installation_id");
      return done("Celiador and GitHub", installed
        ? "<h1>The Celiador GitHub App is installed</h1><p>To let it work on your repositories, connect your GitHub account from Celiador (Settings → GitHub).</p>"
        : "<h1>That link has expired</h1><p>Start again from Celiador (Settings → GitHub → Connect).</p>", installed ? 200 : 400);
    }
    pendingStates.delete(state!);
    const token = await oauthToken({ code, redirect_uri: `${PUBLIC_URL}/api/github/callback` });
    if (!token.ok) return done("Celiador and GitHub", `<h1>GitHub didn't connect</h1><p><code>${escapeHtml(token.error)}</code>. Start again from Celiador.</p>`, 502);
    const me = await userApi(token.identity.accessToken, "/user");
    if (me?.status !== 200 || typeof me.json?.id !== "number" || typeof me.json?.login !== "string") {
      return done("Celiador and GitHub", "<h1>GitHub didn't say who you are</h1><p>Start again from Celiador.</p>", 502);
    }
    const identity: GitHubIdentity = { githubId: me.json.id, login: me.json.login, ...token.identity, connectedAt: new Date().toISOString() };
    const confirm = crypto.randomBytes(24).toString("base64url");
    pendingConfirms.set(confirm, { userId: pending.userId, email: pending.email, identity, exp: Date.now() + FLOW_TTL_MS });
    const account = pending.email ? `<strong>${escapeHtml(pending.email)}</strong>` : "your Celiador account";
    return done("Connect GitHub to Celiador", `<h1>Connect GitHub to Celiador?</h1>
<p>This connects the GitHub account <strong>@${escapeHtml(identity.login)}</strong> to the Celiador account ${account}. Celiador then checks your access before its GitHub App works on a repository for you.</p>
<p><small>Only continue if you started this yourself, from Celiador, and that is your Celiador account. If someone sent you this link, cancel.</small></p>
<form method="post" action="${escapeHtml(PUBLIC_URL)}/api/github/callback/confirm"><input type="hidden" name="confirm" value="${escapeHtml(confirm)}"><button type="submit" name="action" value="connect">Connect @${escapeHtml(identity.login)}</button> <button type="submit" name="action" value="cancel" style="background:#2A3034;color:#E8ECEA">Cancel</button></form>`);
  });

  app.post("/confirm", async (c) => {
    sweep();
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const id = typeof form.confirm === "string" ? form.confirm : "";
    const pending = id ? pendingConfirms.get(id) : undefined;
    if (!pending) return done("Celiador and GitHub", "<h1>That page has expired</h1><p>Start again from Celiador.</p>", 400);
    pendingConfirms.delete(id);
    if (form.action !== "connect") return done("Celiador and GitHub", "<h1>Cancelled</h1><p>Nothing was connected.</p>");
    const owner = userForGitHubId(pending.identity.githubId);
    if (owner && owner !== pending.userId) {
      return done("Celiador and GitHub", `<h1>Already connected elsewhere</h1><p>@${escapeHtml(pending.identity.login)} is connected to another Celiador account. Disconnect it there first.</p>`, 409);
    }
    const previous = githubIdentity(pending.userId);
    if (previous && previous.githubId !== pending.identity.githubId) clearProofs(pending.userId);
    setIdentity(pending.userId, pending.identity);
    const { verified, total } = await verifyAllLinks(pending.userId);
    const repos = total ? ` ${verified} of your ${total} linked ${total === 1 ? "repository is" : "repositories are"} verified.` : "";
    return done("Celiador and GitHub", `<h1>Connected</h1><p>Celiador knows you as <strong>@${escapeHtml(pending.identity.login)}</strong> on GitHub.${repos} You can close this page.</p>`);
  });

  return app;
}
