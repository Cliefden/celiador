# celiador-web — repository assessment

_Assessed 27 Oct 2026, commit `2df0dfb`. A read-only review of the marketing
site: structure, code quality, content discipline, and the gaps that stand
between it and launch._

## Verdict

A small, well-built Next.js marketing site in good health. The architecture is
clean, the copy is unusually disciplined, and the production build passes with
full type-checking. What is left is mostly pre-launch wiring that the README
already names: a waitlist backend, reviewed legal copy, and an Open Graph image.
No structural problems, no risky dependencies, no dead code of note.

## What it is

The marketing site for the current Celiador product: "issue in, pull request
out." Next.js 15 (App Router) with React 19 and Tailwind CSS v4, written in
TypeScript, built to deploy on Vercel. Twenty-one routes, all static or
incrementally regenerated. The codebase is 24 source files, about 1,700 lines.

## Architecture

The design is sound and consistent.

- **Copy lives in one place.** `src/lib/site.ts` holds nav, features, steps,
  pricing tiers, FAQ, and footer links as typed constants; pages render from
  them. Long-form page bodies (start, docs, changelog) keep their prose inline,
  which is the right call since that text is page-specific.
- **Live data fails safe.** `src/lib/releases.ts` and `src/lib/limits.ts` fetch
  the editor's release listing and the daemon's enforced limits at render time
  with a five-minute revalidation window. Both wrap the fetch in try/catch and
  fall back to a "no release" state or documented defaults, so the site builds
  and renders even when `celiador.ai` is unreachable. The limits fallback is
  flagged `live: false` so the page can say it is showing defaults.
- **Components are presentational and reused.** `ui.tsx` (Button, Container,
  Eyebrow, SectionHeading), `icons.tsx` (inline SVGs, no icon dependency), and
  the static mocks (`LoopMock`, `EditorMock`) are pure markup. Only the pieces
  that need state are client components: `Navbar`, `FAQ`, `EmailCapture`,
  `ContactForm`.
- **SEO and PWA basics are present.** `sitemap.ts`, `robots.ts`, `manifest.ts`,
  per-page metadata, Open Graph and Twitter card tags, and an SVG favicon.

## Code quality

Clean and idiomatic. Strict TypeScript is on and the build type-checks every
route. Tailwind v4 theme tokens are centralized in `globals.css`. Accessibility
basics are handled: the FAQ toggles `aria-expanded`, the menu button has an
`aria-label`, inputs are labelled. External links generally carry
`rel="noreferrer"`. The build output is lean: 103 kB of shared JS, the heaviest
page 109 kB first load.

## Content discipline

The strongest feature of the repo, and worth preserving. A stated rule — "never
present something as live that isn't" — is enforced throughout: in-progress
features (cloud runs, plan comments, CI fixes, per-run cost, PR self-review)
carry a "coming" tag wherever they appear, and source comments repeat the rule
so future edits do not drift. Pricing numbers are read from the live enforced
endpoint rather than written into copy, which means the page cannot
overstate the product. The changelog even records the correction of an earlier
pricing page that advertised plans that did not exist.

## Gaps and findings

Ordered by how much they matter before launch. The first three are already in
the README's TODO; the rest are smaller and newly noted here.

1. **No waitlist or contact backend.** `EmailCapture` and `ContactForm` are
   `mailto:` handoffs — they open the visitor's mail client, no request is sent
   or stored. This is done honestly (the copy says so) and is intentional, but
   it means no address is captured without the visitor completing a send in
   their mail app, and anyone without a configured mail client hits a dead end.
   Wire `submit` to a list provider before relying on launch signups.
2. **Legal pages are placeholders.** `/privacy` and `/terms` render through
   `legal.tsx` with a visible "not legal advice" disclaimer and `updated:
   "Preview"`. They need reviewed copy before general availability. `/conduct`
   is intentionally a non-binding pledge and reads as finished.
3. **No Open Graph image.** `opengraph-image.png` is absent, so link previews
   fall back to text. The Twitter card is declared `summary_large_image` with no
   image to fill it. Adding `src/app/opengraph-image.png` resolves both.
4. **`manifest.ts` is stale and off-palette.** Its `description` is still "The
   AI editor for people who ship," which predates the loop repositioning, and
   its `background_color`/`theme_color` are `#0E1113` while the design token
   `--color-ink` and the layout `themeColor` are `#08080a`. A one-line copy and
   color fix.
5. **No CI and no site-level linting.** There is no `.github/` workflow and no
   ESLint config or `lint` script; the only gate is `npm run build`
   type-checking, which `CONTRIBUTING.md` documents as the bar. Given the small
   surface this is defensible, but a GitHub Action running `npm run build` on
   pull requests would catch regressions before the agent-opened PRs are merged.
6. **A few external links in page bodies omit `target`/`rel`.** For example the
   Open VSX link on `/start` and the service-status link on `/contact` open in
   the same tab without `rel="noreferrer"`. Cosmetic and low-risk; the reusable
   `Button` already handles this correctly for external hrefs.

## What I verified

- `npm install` then `npm run build`: clean, 21 routes generated, type-check
  passed, no warnings.
- Read every source file and both library modules.
- Confirmed the absence of `.github/`, ESLint config, and the OG image.

## What I did not do

- Did not run the dev server or inspect rendered pages in a browser, so visual
  layout, responsive behaviour, and the live `celiador.ai` fetches were not
  exercised at runtime.
- Did not audit the external endpoints (`/api/releases`, `/api/limits`)
  themselves; they live in the `daemon` repo.
