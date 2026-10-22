import crypto from "node:crypto";
import type { Context } from "hono";
import type { AppEnv } from "../auth";
import { githubApp } from "../github/app";
import { dispatchTasks, taskStores } from "./dispatch";
import { publishTaskChange } from "./events";
import { repoKey, type TaskRepo } from "./store";

/**
 * GitHub webhook → agent tasks. A repo (or, later, the Celiador GitHub App)
 * sends `issues` and `issue_comment` events here; two of them queue a task for
 * the user the repo is linked to:
 *
 * - an issue gets the `celiador` label (labelling needs triage access already);
 * - a comment containing `@celiador` from an OWNER, MEMBER or COLLABORATOR —
 *   anyone can comment on a public repo, so outsiders are ignored.
 *
 * Signed with CELIADOR_GITHUB_WEBHOOK_SECRET (X-Hub-Signature-256); without the
 * secret the endpoint refuses everything. No user auth: GitHub sends none.
 */

export const TRIGGER_LABEL = "celiador";
const MENTION = /(^|\s)@celiador\b/i;
const TRUSTED_AUTHORS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** Constant-time check of GitHub's `sha256=<hex>` signature over the raw body. */
export function validSignature(secret: string, body: string, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(body).digest("hex"));
  const actual = Buffer.from(header.slice("sha256=".length));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

interface GhRepository { name?: string; owner?: { login?: string }; clone_url?: string }
interface GhIssue { number?: number; title?: string; body?: string | null; html_url?: string; pull_request?: unknown }
interface GhPayload {
  action?: string;
  repository?: GhRepository;
  issue?: GhIssue;
  label?: { name?: string };
  comment?: { body?: string; author_association?: string };
  pull_request?: { merged?: boolean; html_url?: string; head?: { ref?: string } };
}

function repoOf(r: GhRepository | undefined): TaskRepo | undefined {
  if (!r?.name || !r.owner?.login || !r.clone_url || !/^https:\/\//.test(r.clone_url)) return undefined;
  return { owner: r.owner.login, name: r.name, url: r.clone_url };
}

/** What a webhook delivery asks for: a task source, or why it is ignored. Pure; exported for tests. */
export function triggerOf(event: string, p: GhPayload): { source: "issue-label" | "issue-comment" } | { ignore: string } {
  if (event === "issues" && p.action === "labeled") {
    return p.label?.name?.toLowerCase() === TRIGGER_LABEL ? { source: "issue-label" } : { ignore: "another label" };
  }
  if (event === "issue_comment" && p.action === "created") {
    if (p.issue?.pull_request) return { ignore: "comment on a pull request" };
    if (!MENTION.test(p.comment?.body ?? "")) return { ignore: "no @celiador mention" };
    if (!TRUSTED_AUTHORS.has(p.comment?.author_association ?? "")) return { ignore: "commenter is not a collaborator" };
    return { source: "issue-comment" };
  }
  return { ignore: `event ${event}/${p.action ?? "-"}` };
}

export async function githubWebhook(c: Context<AppEnv>): Promise<Response> {
  // Two senders share this endpoint: the per-repo webhooks (CELIADOR_GITHUB_WEBHOOK_SECRET)
  // and the Celiador GitHub App (its own secret, stored at setup). Either signature is good.
  const secrets = [process.env.CELIADOR_GITHUB_WEBHOOK_SECRET, githubApp()?.webhookSecret].filter((s): s is string => !!s);
  if (secrets.length === 0) return c.json({ error: "webhook not configured" }, 503);
  const body = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");
  if (!secrets.some((secret) => validSignature(secret, body, signature))) {
    return c.json({ error: "bad signature" }, 401);
  }
  const event = c.req.header("x-github-event") ?? "";
  if (event === "ping") return c.json({ ok: true, pong: true });

  let payload: GhPayload;
  try {
    payload = JSON.parse(body) as GhPayload;
  } catch {
    return c.json({ error: "bad payload" }, 400);
  }
  if (event === "pull_request") return pullRequestEvent(c, payload);
  const trigger = triggerOf(event, payload);
  if ("ignore" in trigger) return c.json({ ok: true, ignored: trigger.ignore });

  const repo = repoOf(payload.repository);
  const issue = payload.issue;
  if (!repo || typeof issue?.number !== "number" || !issue.title || !issue.html_url) {
    return c.json({ ok: true, ignored: "incomplete payload" });
  }
  const userId = taskStores.links.owner(repo.url);
  if (!userId) return c.json({ ok: true, ignored: "repo is not linked to a Celiador account" });

  const store = taskStores.for(userId);
  const existing = store.openForIssue(repo, issue.number);
  if (existing) return c.json({ ok: true, ignored: "already queued", taskId: existing.id });

  const task = store.create({
    repo,
    issue: { number: issue.number, title: issue.title, url: issue.html_url },
    title: issue.title,
    body: issue.body ?? "",
    source: trigger.source,
  });
  publishTaskChange(userId, task);
  dispatchTasks(userId);
  return c.json({ ok: true, taskId: task.id, state: store.get(task.id)?.state }, 201);
}

/**
 * A pull request merged on GitHub itself (the web UI, a teammate, anywhere but
 * the phone) still counts: the task whose branch it is moves to `merged`, so the
 * north-star number is right however the PR was merged.
 */
function pullRequestEvent(c: Context<AppEnv>, p: GhPayload): Response {
  if (p.action !== "closed" || p.pull_request?.merged !== true) return c.json({ ok: true, ignored: `pull_request/${p.action ?? "-"}` });
  const repo = repoOf(p.repository);
  const head = p.pull_request.head?.ref;
  if (!repo || !head) return c.json({ ok: true, ignored: "incomplete payload" });
  const userId = taskStores.links.owner(repo.url);
  if (!userId) return c.json({ ok: true, ignored: "repo is not linked to a Celiador account" });
  const store = taskStores.for(userId);
  const task = store.list().find((t) => repoKey(t.repo.url) === repoKey(repo.url) && t.branch === head && t.state !== "merged");
  if (!task) return c.json({ ok: true, ignored: "no task for this branch" });
  const updated = store.update(task.id, { state: "merged", ...(p.pull_request.html_url ? { prUrl: p.pull_request.html_url } : {}) })!;
  publishTaskChange(userId, updated);
  dispatchTasks(userId);
  return c.json({ ok: true, taskId: task.id, state: "merged" });
}
