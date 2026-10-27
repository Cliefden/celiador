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
- TypeScript, deploy target **Vercel**

## Develop

```sh
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve the build
```

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
