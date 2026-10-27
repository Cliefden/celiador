# The Celiador GitHub App

The daemon's own GitHub identity. With it installed on an organization:

- one webhook for every repository the app is installed on (no more per-repo webhooks and shared secrets);
- the daemon narrates each run on its issue as **Celiador** — picked up, the agent's plan, its questions and approvals, the pull request, failing checks, failures — instead of the editor commenting as the signed-in developer, and writes the pull request body (what the agent did, its self-review, where / how long / how much);
- questions and approvals can be **answered by replying to the issue** (below);
- cloud (sandbox) runs can clone **private** repositories, push their branch and open the pull request with a short-lived installation token — the App is required for cloud runs;
- a pull request merged anywhere (GitHub's UI, a teammate) moves its task to `merged`, so the merged-PR count is right however the PR was merged.

## Create it (once, about a minute)

1. Open `https://celiador.ai/api/github/app/new` as an **owner of the GitHub organization** (`CELIADOR_GITHUB_ORG`, default `Cliefden`).
2. Click **Continue to GitHub**. The manifest (name, webhook URL, permissions, events) is filled in; GitHub shows it and asks you to confirm.
3. GitHub sends you back to `/api/github/app/setup`. The daemon exchanges the one-time code for the app's id, private key and webhook secret and stores them in `data/github-app.json` (mode 0600). Nothing is typed or pasted.
4. Click **install it on the organization** and choose the repositories agents may work on.

Permissions requested: issues (write), pull requests (write), contents (write), metadata (read), checks (read), commit statuses (read). Events: `issues`, `issue_comment`, `pull_request`, `check_suite`, `status`.

### Checks and statuses (added 2026-10)

The queue's "Ready to merge" cards show a pull request's CI state, which needs **checks: read** and **commit statuses: read** plus the `check_suite` and `status` events. An app created before this change doesn't have them:

1. Open the app's settings (`https://github.com/organizations/<org>/settings/apps/<slug>/permissions`), add *Checks: Read-only* and *Commit statuses: Read-only*, subscribe to *Check suite* and *Status*, and save.
2. GitHub then asks the **organization owner to approve the new permissions on the installation** (a banner under the org's *Settings → GitHub Apps → Celiador*). Until they approve, everything else keeps working: the daemon asks for an installation token with checks/statuses, gets a 422, retries without them, and the checks badge reads `unknown`.

## Reply to the issue to answer the agent

When a run stops on a question or an approval, the issue gets a comment —
**Question from the agent.** with numbered choices, or **Needs approval.** with the
command / diff preview — telling the reader how to answer. A reply on the issue from
an **owner, member or collaborator** of the repository is relayed to the run:

- question: a lone number picks that choice (`2`), anything else is the answer as written;
- approval: a reply starting with `approve`, `yes` or `ok` approves; `deny` or `no` rejects; other replies are ignored.

The daemon acknowledges with a 👍 reaction on the reply (no extra comment); the
task's `awaiting` clears as the run reports, exactly as if the phone had answered.
Replies from outsiders are ignored, as are replies while the run isn't waiting
(those still count as `@celiador` mentions on an issue with no open task). The
run's editor has to be online — the comment is relayed over its session; a reply
that finds no runner is ignored (the queue still shows the question).

## What changes afterwards

| Before | After |
|---|---|
| Per-repo webhook, `CELIADOR_GITHUB_WEBHOOK_SECRET` | The app's webhook; both secrets stay accepted, so old hooks can be removed at leisure |
| Editor posts the "picked up" comment via the developer's gh token | Daemon posts it as the app when the editor reports `running` (naming the machine — or "the Celiador cloud" — with "Watch the run" / "Open the queue" links to `/api/open/*`) and "Pull request opened: <url>" on the first `pr-open`; the editor is told at dispatch (`commented: true`) and skips |
| The issue only learns about the PR | **Plan.** (the first assistant message under a `Plan:` heading), **Question from the agent.** / **Needs approval.** while the run waits, **Checks failed** (the agent is taking a look, attempt k of N — or it'll retry when a runner is online), **Failed.** — each once |
| The editor writes the PR body from the final message | The daemon composes it from the editor's `summary` (or the cloud run's final message) and PATCHes the PR: what the agent did, self-review, run-by / files / elapsed / cost |
| CI failures are the human's | A failed `check_suite` / `check_run` on a pr-open task's branch becomes a fix follow-up to the run, once per head sha, at most `CELIADOR_TASK_CI_FIX_ATTEMPTS` (default 2) per task |
| PR cards show what the editor reported | Size, mergeable and CI checks refreshed from GitHub (on pr-open, on PR/CI webhooks, and when a listing finds them older than 60 s) |
| Merging a task's PR needs the editor online | `POST /api/tasks/:id/merge` merges as the app; the editor is only the fallback |
| Cloud runs: public repos only, and only on request | Tasks no online editor can take run in the cloud: clone (private too), push the branch and open the PR with an installation token (in the URL of that one git command — never written to disk or logs). Repos without the App wait for an editor |
| Task `merged` only via the phone's merge call | Also when the PR is merged on GitHub |

## Self-hosting

Each self-hosted daemon creates its **own** app the same way (set `CELIADOR_PUBLIC_URL` and `CELIADOR_GITHUB_ORG`). The hosted celiador.ai app is not shared.

## Rotation / removal

Delete `data/github-app.json` and restart to forget the app; revoke it under the organization's GitHub App settings. The setup page then offers to create a new one.
