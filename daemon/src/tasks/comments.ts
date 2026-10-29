import { commentOnIssue, githubApp, PUBLIC_URL } from "../github/app";
import { taskStores } from "./dispatch";
import { extractPlan } from "./prBody";
import type { Task, TaskPosted } from "./store";

/**
 * GitHub as the product surface: the issue narrates the run. Every comment here
 * is posted as the Celiador GitHub App, once per event (the task's internal
 * `posted` record is marked BEFORE the request goes out, so a replayed event or a
 * re-sent report can't post twice), and only for issue tasks on a repo the App
 * is installed on — without the App the daemon stays silent, as before. The
 * "Picked up" / "Pull request opened" comments live next to the PR code in
 * pulls.ts; this file holds the ones derived from the run's transcript and CI.
 */

/** Longest approval preview the issue comment shows. */
const MAX_PREVIEW = 800;

/** Mark a one-time comment as posted; false when it already was (or the task is not commentable). */
function claim(userId: string, task: Task, patch: Partial<TaskPosted>, already: (p: TaskPosted) => boolean): boolean {
  if (!githubApp() || !task.issue) return false;
  const posted = task.posted ?? {};
  if (already(posted)) return false;
  taskStores.for(userId).update(task.id, { posted: { ...posted, ...patch } });
  return true;
}

function post(task: Task, body: string): void {
  if (!task.issue) return;
  void commentOnIssue(task.repo, task.issue.number, body).catch(() => undefined);
}

/**
 * The agent's plan, from the first assistant message that carries a "Plan:"
 * heading: `**Plan.**` + the plan lines (≤1500 chars). Returns whether a comment
 * went out (so the caller stops looking once it has).
 */
export function postPlanComment(userId: string, task: Task, assistantText: string): boolean {
  if (task.posted?.plan || !githubApp() || !task.issue) return false;
  const plan = extractPlan(assistantText);
  if (!plan) return false;
  if (!claim(userId, task, { plan: true }, (p) => !!p.plan)) return false;
  post(task, `**Plan.**\n${plan}`);
  return true;
}

/**
 * The run needs the user: a question (with numbered choices) or an approval
 * (with its preview in a code block), each telling the reader how to answer
 * from the issue. One comment per requestId.
 */
export function postAwaitingComment(userId: string, task: Task): void {
  const awaiting = task.awaiting;
  if (!awaiting || !claim(userId, task, { awaiting: awaiting.requestId }, (p) => p.awaiting === awaiting.requestId)) return;
  if (awaiting.kind === "question") {
    const choices = awaiting.choices?.length ? `\n\n${awaiting.choices.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : "";
    post(task, `**Question from the agent.** ${awaiting.text}${choices}\n\nReply to this issue to answer (a number picks a choice), or answer in the Celiador queue.`);
  } else {
    const preview = awaiting.preview?.trim();
    const block = preview ? `\n\n\`\`\`\n${preview.length > MAX_PREVIEW ? `${preview.slice(0, MAX_PREVIEW - 1)}…` : preview}\n\`\`\`` : "";
    post(task, `**Needs approval.** ${awaiting.text}${block}\n\nReply **approve** or **deny**, or decide in the Celiador queue.`);
  }
}

/** The run failed: one comment with the readable error and a way back to the queue. */
export function postFailedComment(userId: string, task: Task): void {
  if (task.state !== "failed" || !claim(userId, task, { failed: true }, (p) => !!p.failed)) return;
  post(task, `**Failed.** ${task.error?.trim() || "The run did not finish."}\n\n[Open the queue](${PUBLIC_URL}/api/open/queue)`);
}

/**
 * CI failed on the PR's head `sha`: either the agent is on it (attempt k of N),
 * or no runner is online and it will be retried, or the attempts are used up.
 * One comment per head sha (the give-up note once per task).
 */
export function postChecksFailedComment(userId: string, task: Task, sha: string, outcome: { kind: "fixing"; attempt: number; max: number } | { kind: "waiting" } | { kind: "gave-up"; max: number }): void {
  if (outcome.kind === "gave-up") {
    if (!claim(userId, task, { ciGaveUp: true }, (p) => !!p.ciGaveUp)) return;
    post(task, `**Checks failed** — I've made ${outcome.max} ${outcome.max === 1 ? "attempt" : "attempts"} to fix them and won't try again on my own. Send the run back from the Celiador queue, or take it from here.`);
    return;
  }
  const seen = task.posted?.checksFailed ?? [];
  if (!claim(userId, task, { checksFailed: [...seen, sha].slice(-20) }, (p) => (p.checksFailed ?? []).includes(sha))) return;
  post(task, outcome.kind === "fixing"
    ? `**Checks failed** — the agent is taking a look (attempt ${outcome.attempt} of ${outcome.max}).`
    : "**Checks failed** — I'll retry when a runner is online.");
}
