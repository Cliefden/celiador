# Celiador (`Cliefden/celiador`)

Celiador is the loop: label a GitHub issue `celiador` and an agent runs it in its
own git worktree, comments on the issue, opens a pull request that closes it, and
you review and merge from your phone. This repository holds everything in that
loop except the editor:

| Directory | What | Docs |
|---|---|---|
| [`daemon/`](daemon/) | The hub the loop runs through: GitHub App webhooks → task queue → runners (editor, Celiador Remote, cloud sandbox), the agent proxy on the server-held Anthropic key, the session relay to the phone, Supabase auth, APNs, the editor's release feed. Node + Hono, run with `tsx`. | [`daemon/README.md`](daemon/README.md), [`daemon/docs/`](daemon/docs/) |
| [`ios/`](ios/) | The iPhone companion: the queue, what needs you, the pull requests ready to review; approve, answer, follow up and merge from the phone. XcodeGen project, built to TestFlight by `.github/workflows/ios.yml`. | [`ios/README.md`](ios/README.md), [`ios/CHANNELS.md`](ios/CHANNELS.md), [`ios/TESTFLIGHT.md`](ios/TESTFLIGHT.md) |
| [`web/`](web/) | The marketing site at celiador.ai: the loop, pricing, downloads, docs. Next.js. | [`web/README.md`](web/README.md) |

The editor is its own repository, [`Cliefden/celiador-editor`](https://github.com/Cliefden/celiador-editor)
(a hard fork of VS Code with the built-in `celiador-ai` extension); the stock
VS Code / Cursor runner is [`Cliefden/celiador-remote`](https://github.com/Cliefden/celiador-remote).

Each directory is self-contained: its own `package.json` / `project.yml`, its own
`.gitignore`, its own build. Nothing is shared at the root except what spans
them all:

- [`ENVIRONMENTS.md`](ENVIRONMENTS.md) — dev / test / prod: hosts, ports, auth
  isolation, the box layout, the client build channels.
- [`RELEASING.md`](RELEASING.md) + [`CHANGELOG.md`](CHANGELOG.md) — one release
  train: `scripts/release.sh` bumps the daemon and the iOS app together and a
  `vX.Y.Z` tag ships both to test.
- [`.github/workflows/`](.github/workflows/) — `ci.yml` (daemon typecheck +
  smoke), `deploy.yml` (daemon → dev / test / prod), `web-deploy.yml` (site →
  dev / test / prod); `ios.yml` builds the iPhone app on a macOS runner and
  uploads it to TestFlight on the same triggers.

## Develop

```sh
npm --prefix daemon install && npm --prefix daemon run dev   # http://127.0.0.1:4661
npm --prefix web install && npm --prefix web run dev         # http://localhost:3000
cd ios && xcodegen generate && open Celiador.xcodeproj
```

Or, with `wb` (github.com/Cliefden/workbench), `wb start <issue>` gives an
issue its own worktree with both services running.

## History

Until 2026-10-29 these were three repositories — `Cliefden/daemon` (renamed to
this one; its history is unchanged, the files moved down into `daemon/`),
`Cliefden/celiador-ios` and `Cliefden/celiador-web` (imported with their full
history under `ios/` and `web/`, the old iOS tags as `ios-v*`). The old
repositories are archived and redirect here.
