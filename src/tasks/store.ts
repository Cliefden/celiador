import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Agent tasks: units of work that end in a pull request (Phase 1 of the
 * agent-first plan). A task is created from a GitHub issue (label `celiador`,
 * or a collaborator's `@celiador` comment) or by hand from the phone, queued per
 * user, dispatched to the user's editor — which runs it in its own worktree on
 * its own branch — and tracked to an open pull request.
 *
 * File-backed like the session store: one JSON file per user plus one file of
 * repo links (which user a repo's issues belong to).
 */

export type TaskState = "queued" | "dispatched" | "running" | "pr-open" | "merged" | "failed" | "cancelled";

/** Tasks in these states hold one of the user's parallel slots. */
export const ACTIVE_STATES: ReadonlySet<TaskState> = new Set(["dispatched", "running"]);
/** Tasks in these states are finished; nothing moves them again except a new task. */
export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set(["pr-open", "merged", "failed", "cancelled"]);

export interface TaskRepo {
  readonly owner: string;
  readonly name: string;
  /** Normalised https clone URL, the same form the editor's presence heartbeat uses. */
  readonly url: string;
}

export interface TaskIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
}

/** What the linked session is blocked on, while it waits for the user. */
export interface TaskAwaiting {
  readonly kind: "permission" | "question";
  /** Pass to the session's approve/reject/answer endpoints. */
  readonly requestId: string;
  /** permission: the approval's title or command; question: the prompt. */
  readonly text: string;
  readonly preview?: string;
  readonly choices?: string[];
}

export type TaskChecks = "passing" | "failing" | "pending" | "none" | "unknown";

/** The task's pull request as last seen (editor report, refreshed from GitHub with the App). */
export interface TaskPullRequest {
  readonly number: number;
  readonly url: string;
  readonly additions?: number;
  readonly deletions?: number;
  readonly changedFiles?: number;
  readonly checks?: TaskChecks;
  /** GitHub's mergeable flag (false = conflicts); absent while GitHub computes it. */
  readonly mergeable?: boolean;
  /** When the daemon last refreshed it. */
  readonly updatedAt: string;
}

export interface Task {
  readonly id: string;
  readonly repo: TaskRepo;
  readonly issue?: TaskIssue;
  readonly title: string;
  /** What the agent is told, built once at creation. */
  readonly prompt: string;
  /** The branch (and worktree) the run works on. */
  readonly branch: string;
  readonly source: "issue-label" | "issue-comment" | "manual";
  state: TaskState;
  sessionId?: string;
  prUrl?: string;
  error?: string;
  readonly createdAt: string;
  updatedAt: string;
  /** Where it runs: "mac" = an editor took it at dispatch. */
  runner?: "mac" | "cloud";
  /** The editor's computer name, as it reported it. */
  machine?: string;
  /** First time the state became `running`. */
  startedAt?: string;
  /** When it reached pr-open / failed / merged / cancelled (cleared by a follow-up run). */
  finishedAt?: string;
  /** Latest one-line activity of the linked session; in memory only, never written to disk. */
  activity?: string;
  awaiting?: TaskAwaiting;
  pr?: TaskPullRequest;
  /** Daemon-internal: which issue comments the App already posted. Stripped from API output. */
  posted?: { pickedUp?: boolean; prOpened?: boolean };
}

/** Fields a task update may set; an explicit `undefined` removes the field. */
export type TaskPatch = Partial<
  Pick<Task, "state" | "sessionId" | "prUrl" | "error" | "runner" | "machine" | "startedAt" | "finishedAt" | "activity" | "awaiting" | "pr" | "posted">
>;

/** A task as clients see it (internal bookkeeping removed). */
export function publicTask(task: Task): Omit<Task, "posted"> {
  const { posted: _posted, ...rest } = task;
  return rest;
}

/** `https://github.com/<owner>/<repo>/pull/<n>` → n. */
export function prNumberFromUrl(url: string | undefined): number | undefined {
  const m = url ? /\/pull\/(\d{1,9})(?:[/?#]|$)/.exec(url) : null;
  return m ? Number(m[1]) : undefined;
}

/** `https://github.com/<owner>/<repo>.git`, lower-cased for matching. */
export function repoKey(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "").replace(/\.git$/, "");
}

/** A git-safe branch name from an issue number and title. */
export function branchFor(title: string, issueNumber?: number, id?: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const prefix = issueNumber !== undefined ? String(issueNumber) : `celiador-${(id ?? randomUUID()).slice(0, 6)}`;
  return slug ? `${prefix}-${slug}` : prefix;
}

/** The instruction the agent gets. Kept plain: the issue is the spec. */
export function promptFor(task: { repo: TaskRepo; issue?: TaskIssue; title: string }, body: string): string {
  const head = task.issue
    ? `Resolve GitHub issue #${task.issue.number} in ${task.repo.owner}/${task.repo.name}: "${task.issue.title}".`
    : `Task in ${task.repo.owner}/${task.repo.name}: ${task.title}`;
  const description = body.trim() ? `\n\n${task.issue ? "Issue description" : "Details"}:\n${body.trim().slice(0, 20_000)}` : "";
  const footer = task.issue
    ? `\n\nKeep the change focused on this issue. When the work is done, commit it with a message that references #${task.issue.number}.`
    : "\n\nKeep the change focused. When the work is done, commit it.";
  return `${head}${description}${footer}`;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/** Cap on stored tasks per user; the oldest finished ones are dropped first. */
const MAX_TASKS = 500;

export class TaskStore {
  private tasks: Task[];

  constructor(private readonly file: string) {
    this.tasks = readJson<Task[]>(file) ?? [];
  }

  list(): Task[] {
    return [...this.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Queued tasks in the order they were created (dispatch order). */
  queued(): Task[] {
    return this.tasks.filter((t) => t.state === "queued");
  }

  get(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  /** The task whose editor run is relay session `sessionId`, if any. */
  forSession(sessionId: string): Task | undefined {
    return this.tasks.find((t) => t.sessionId === sessionId);
  }

  /** An unfinished task for the same repo + issue, if any (dedupe for webhooks). */
  openForIssue(repo: TaskRepo, issueNumber: number): Task | undefined {
    const key = repoKey(repo.url);
    return this.tasks.find((t) => repoKey(t.repo.url) === key && t.issue?.number === issueNumber && !TERMINAL_STATES.has(t.state));
  }

  create(input: { repo: TaskRepo; issue?: TaskIssue; title: string; body: string; source: Task["source"] }): Task {
    const id = randomUUID();
    const now = new Date().toISOString();
    const task: Task = {
      id,
      repo: input.repo,
      issue: input.issue,
      title: input.title.slice(0, 400),
      prompt: promptFor(input, input.body),
      branch: branchFor(input.title, input.issue?.number, id),
      source: input.source,
      state: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.push(task);
    if (this.tasks.length > MAX_TASKS) {
      const finished = this.tasks.filter((t) => TERMINAL_STATES.has(t.state)).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      const drop = new Set(finished.slice(0, this.tasks.length - MAX_TASKS).map((t) => t.id));
      this.tasks = this.tasks.filter((t) => !drop.has(t.id));
    }
    this.save();
    return task;
  }

  /**
   * Patch a task and persist it. A state change also keeps the timeline right:
   * `running` stamps startedAt (once) and clears finishedAt (a follow-up turn
   * after pr-open); reaching a terminal state stamps finishedAt and drops the
   * live fields (activity, awaiting).
   */
  update(id: string, patch: TaskPatch): Task | undefined {
    const task = this.get(id);
    if (!task) return undefined;
    const now = new Date().toISOString();
    const next: TaskPatch = { ...patch };
    if (patch.state === "running") {
      if (!task.startedAt && !("startedAt" in patch)) next.startedAt = now;
      next.finishedAt = undefined;
    } else if (patch.state && TERMINAL_STATES.has(patch.state)) {
      if ((task.state !== patch.state || !task.finishedAt) && !("finishedAt" in patch)) next.finishedAt = now;
      next.activity = undefined;
      next.awaiting = undefined;
    }
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) delete (task as unknown as Record<string, unknown>)[key];
      else (task as unknown as Record<string, unknown>)[key] = value;
    }
    task.updatedAt = now;
    this.save();
    return task;
  }

  /** The live activity line: memory only (it changes many times a second while a run streams). */
  setActivity(id: string, activity: string | undefined): Task | undefined {
    const task = this.get(id);
    if (!task) return undefined;
    if (activity) task.activity = activity;
    else delete task.activity;
    return task;
  }

  private save(): void {
    writeJson(this.file, this.tasks.map(({ activity: _activity, ...rest }) => rest));
  }
}

/** Which user a repo's issues belong to. One owner per repo in v1. */
export class RepoLinks {
  private links: Record<string, { userId: string; url: string }>;

  constructor(private readonly file: string) {
    this.links = readJson<Record<string, { userId: string; url: string }>>(file) ?? {};
  }

  owner(url: string): string | undefined {
    return this.links[repoKey(url)]?.userId;
  }

  forUser(userId: string): string[] {
    return Object.values(this.links).filter((l) => l.userId === userId).map((l) => l.url);
  }

  /** Link a repo to a user; false when another user already owns it. */
  link(userId: string, url: string): boolean {
    const key = repoKey(url);
    const existing = this.links[key];
    if (existing && existing.userId !== userId) return false;
    this.links[key] = { userId, url };
    writeJson(this.file, this.links);
    return true;
  }

  unlink(userId: string, url: string): void {
    const key = repoKey(url);
    if (this.links[key]?.userId === userId) {
      delete this.links[key];
      writeJson(this.file, this.links);
    }
  }

  purgeUser(userId: string): void {
    for (const [key, link] of Object.entries(this.links)) {
      if (link.userId === userId) delete this.links[key];
    }
    writeJson(this.file, this.links);
  }
}

export class TaskStores {
  private readonly stores = new Map<string, TaskStore>();
  readonly links: RepoLinks;

  constructor(private readonly root: string) {
    this.links = new RepoLinks(path.join(root, "data", "tasks", "repo-links.json"));
  }

  for(userId: string): TaskStore {
    let store = this.stores.get(userId);
    if (!store) {
      store = new TaskStore(path.join(this.root, "data", "tasks", `${userId}.json`));
      this.stores.set(userId, store);
    }
    return store;
  }

  /** Account deletion: every task and repo link of the user. */
  purge(userId: string): void {
    this.stores.delete(userId);
    fs.rmSync(path.join(this.root, "data", "tasks", `${userId}.json`), { force: true });
    this.links.purgeUser(userId);
  }
}
