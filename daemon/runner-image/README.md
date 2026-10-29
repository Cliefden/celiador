# Cloud runner image

The container each cloud run executes in (Phase 3b; `src/runner/sandbox.ts`).

```sh
docker build -t celiador-runner:1 runner-image     # on the box, from ~/daemon
bash scripts/sandbox-check.sh                        # proves the isolation, no model needed
```

Then set `CELIADOR_RUNNER_AGENT=sandbox` in the daemon's `.env` and restart. Without
it (or without the image) cloud runs use the deterministic placeholder agent.

Isolation the daemon applies (`dockerRunArgs`): `--network none` (the only way out is
the per-run gateway socket → the daemon's own Anthropic gateway, authenticated with a
runner token for that user and run), read-only root, tmpfs `/tmp` and `$HOME`,
`--cap-drop ALL`, `no-new-privileges`, the daemon's non-root uid, 1.5 CPU / 3 GB /
512 pids, a 30-minute wall clock (`CELIADOR_RUNNER_TIMEOUT_MS`) and `docker kill`
on cancel. Only the run's workspace is writable.

Bumping Claude Code: change `CLAUDE_CODE_VERSION`, rebuild with a new tag, point
`CELIADOR_RUNNER_IMAGE` at it.
