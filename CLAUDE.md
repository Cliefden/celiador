# CLAUDE.md

How work moves through this repo (daemon/, ios/, web/, packages/client/). What
each part is and how to build it: README.md, daemon/README.md, ios/README.md,
ENVIRONMENTS.md, RELEASING.md.

## Worktrees

Parallel work happens in worktrees under `.claude/worktrees/` (gitignored), one
per issue branch, through `wb` (github.com/Cliefden/workbench; the manual is
its `WORKTREES.md`). `wb issue` files an issue into Backlog, `wb start
<issue#>` takes one from the board (assigns, In progress, worktree;
`/start-issue` wraps it), `wb new <issue#>` only creates and sets one up, `wb
setup` sets up one you are in (e.g. one Claude Code created), `wb status`
shows every worktree's issue, changes, push/PR state and what can be removed,
and `wb pr` opens the PR and moves the issue to In review — only when the user
asks, as it pushes.

- Gitignored files a build needs (`daemon/.env`, local Claude settings) are
  listed in `.worktreeinclude`; new worktrees get them from the main checkout.
  Add new ones there.
- Inside a worktree, run commands from its root. Never `cd` into the main
  checkout or other worktrees to edit or run git there.
- Only the repo is per-worktree. Ports 4661 (daemon) and 3000 (web) are
  shared: `wb dev` moves the running daemon and site to the checkout it is run
  from, `wb dev status` shows where they run.
- The git stash is shared across worktrees. Set work aside with a WIP commit,
  not `git stash`.

## Pushing deploys

- **A push to `main` deploys dev** (daemon, site, the Dev iOS build). A pushed
  `vX.Y.Z` tag deploys test; prod is a manual dispatch. Commit freely; push
  only when asked.
- **PRs open as drafts**, which run no CI (`wb pr`); run the checks locally,
  then `gh pr ready` once. PRs land in **merge trains** (`wb train`, WORKTREES.md
  § 3.7), not with `gh pr merge`: one CI run and one dev deploy per train.
  `wb train land` pushes `main`: only when asked. Don't re-run whole workflows
  for a flaky job; re-run the failed job (`gh run rerun <id> --failed`).
- **The repo is public.** An exploitable security problem goes into a private
  security advisory, never an issue; its fix PR uses neutral wording, no
  advisory id and no closing keyword. Its worktree is a plain branch
  (`wb new <name>`), shown as "(no issue)".
- **Never put the `celiador` label on an issue**: it starts an agent run.
