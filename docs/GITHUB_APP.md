# The Celiador GitHub App

The daemon's own GitHub identity. With it installed on an organization:

- one webhook for every repository the app is installed on (no more per-repo webhooks and shared secrets);
- the daemon comments on issues as **Celiador** when a run picks them up, instead of the editor commenting as the signed-in developer;
- cloud (sandbox) runs can clone **private** repositories with a short-lived installation token;
- a pull request merged anywhere (GitHub's UI, a teammate) moves its task to `merged`, so the merged-PR count is right however the PR was merged.

## Create it (once, about a minute)

1. Open `https://celiador.ai/api/github/app/new` as an **owner of the GitHub organization** (`CELIADOR_GITHUB_ORG`, default `Cliefden`).
2. Click **Continue to GitHub**. The manifest (name, webhook URL, permissions, events) is filled in; GitHub shows it and asks you to confirm.
3. GitHub sends you back to `/api/github/app/setup`. The daemon exchanges the one-time code for the app's id, private key and webhook secret and stores them in `data/github-app.json` (mode 0600). Nothing is typed or pasted.
4. Click **install it on the organization** and choose the repositories agents may work on.

Permissions requested: issues (write), pull requests (write), contents (write), metadata (read). Events: `issues`, `issue_comment`, `pull_request`.

## What changes afterwards

| Before | After |
|---|---|
| Per-repo webhook, `CELIADOR_GITHUB_WEBHOOK_SECRET` | The app's webhook; both secrets stay accepted, so old hooks can be removed at leisure |
| Editor posts the "picked up" comment via the developer's gh token | Daemon posts it as the app at dispatch; the editor is told (`commented: true`) and skips |
| Cloud runs: public repos only | Private repos clone with an installation token (never written to disk or logs) |
| Task `merged` only via the phone's merge call | Also when the PR is merged on GitHub |

## Self-hosting

Each self-hosted daemon creates its **own** app the same way (set `CELIADOR_PUBLIC_URL` and `CELIADOR_GITHUB_ORG`). The hosted celiador.ai app is not shared.

## Rotation / removal

Delete `data/github-app.json` and restart to forget the app; revoke it under the organization's GitHub App settings. The setup page then offers to create a new one.
