# Changelog fragments

Each user-visible change adds its own file here instead of editing
`CHANGELOG.md`, so open pull requests — parallel worktrees, merge trains —
don't conflict with each other (#155). Same scheme as Celindor.

Add `changes/unreleased/<issue#>-<slug>.md` in the same pull request as the change:

```markdown
### Cloud sessions keep going when the phone sleeps (#160)

- **ios:** what changed, written for someone using the app.
- **daemon:** one bullet per area the change touches (`daemon`, `ios`, `web`).
```

The file must start with the `### Title (#NNN)` heading, listing the file's own
issue (`(#801, #802)` for more than one). CI (`changelog.yml`) checks this with
`node scripts/changelog-roll.mjs --check`. Use more than one file if a pull
request makes separate changes. A change nobody using Celiador would notice
(CI, docs, refactors) needs no fragment.

`scripts/release.sh` gathers the fragments into the new version's section of
`CHANGELOG.md`, highest issue number first, followed by anything still written
under `## [Unreleased]`, and deletes them.

A fix from a private security advisory has no public issue: name the file
after its PR number instead, with neutral wording.
