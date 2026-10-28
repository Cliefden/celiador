# celiador-web

Marketing site for **Celiador**: issue in, pull request out. Label a GitHub issue
`celiador` and an agent runs it on your Mac in its own git worktree, opens a pull
request that closes the issue, and you review and merge from your phone. The site
sells that loop; the Celiador editor (a VS Code fork), the Celiador Remote
extension (VS Code or Cursor) and the cloud (in progress) are the runners it can
run on, and the editor download is one path in, not the headline. The previous
product's site lives in `../celiador-web-old` (the old Lovable-style app builder,
kept for reference).

Copy rule: never present something as live that isn't. Cloud runs, plan and
question comments on the issue, CI fixes, per-run cost and the PR self-review
section are in progress and carry a "coming" tag wherever they appear.

## Stack

- **Next.js 15** (App Router) + **React 19**
- **Tailwind CSS v4** (via `@tailwindcss/postcss`; theme tokens in `src/app/globals.css`)
- TypeScript, self-hosted on the box behind Caddy (see Deploy)

## Develop

```sh
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve the build
```

## Deploy

One Next.js server per environment on the box, behind Caddy
(`daemon/ENVIRONMENTS.md`): `celiador-web@dev` on `:3103` for `dev.celiador.ai`,
`celiador-web@test` on `:3102` for `test.celiador.ai`, and prod on `:3100`
(the plain `celiador-web` unit at `~/celiador-web` until its cutover to
`celiador-web@prod` under `~/envs/prod/web`). Each reads `~/envs/<env>/web.env`
(port, `CELIADOR_RELEASES_API` = its own daemon's listing).

- First time, on the box: `deploy/provision-web.sh <test|dev>` (writes
  `web.env`, builds this checkout, installs `deploy/celiador-web@.service`).
- Then `.github/workflows/deploy.yml`: a push to `main` deploys dev, a
  `vX.Y.Z` tag deploys test, *Actions → Deploy → Run workflow* deploys any
  environment (prod needs the repository variable `PROD_ENABLED=true`). The
  runner builds, rsyncs over the deploy key held in the GitHub Environment
  (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`), restarts the unit and checks the
  page. Results are mailed (`SMTP_USER` / `SMTP_PASS` secrets, `NOTIFY_TO`).
- By hand: rsync the checkout to `~/envs/<env>/web`, `npm ci && npm run build`,
  `sudo systemctl restart celiador-web@<env>`.

## Structure

```
src/app/            App Router pages: / (home), /start, /features, /switch, /pricing,
                    /download, /docs, /about, /contact, /changelog, /privacy, /terms
src/components/     Navbar, Footer, LoopMock (issue + phone), EditorMock, FAQ,
                    EmailCapture, ContactForm, ui, icons
src/lib/site.ts     All marketing copy + config (nav, features, pricing, FAQ, footer)
src/app/globals.css Tailwind v4 import + design tokens (colors, fonts, helpers)
```

Edit copy in **`src/lib/site.ts`** — pages read from it, so text stays in one place.

## Before launch — TODO

- **Download link**: DONE — `/download` and `/releases` read the daemon's release
  listing (`src/lib/releases.ts`, `https://celiador.ai/api/releases`, revalidated
  every 5 min; `CELIADOR_RELEASES_API` overrides) and fall back to the notify form
  when nothing is published. Set `site.testflightUrl` once the public TestFlight
  link exists.
- **Email capture**: `src/components/EmailCapture.tsx` and `ContactForm.tsx` are
  UI-only (they show a success state, no request). Wire `submit` to your waitlist
  backend (Supabase, Loops, Resend, etc.).
- **Legal**: `/privacy` and `/terms` are placeholders — replace with reviewed copy.
- **OG image**: add `src/app/opengraph-image.png` for rich link previews.
