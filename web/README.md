# celiador-web

Marketing site for **Celiador** — the native macOS AI code editor (the new,
Cursor-style product; a hard fork of VS Code). This is a fresh site for the new
product. The previous product's site lives in `../celiador-web-old` (the old
Lovable-style app builder, kept for reference).

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
src/app/            App Router pages: / (home), /features, /pricing,
                    /download, /about, /contact, /changelog, /privacy, /terms
src/components/     Navbar, Footer, EditorMock, FAQ, EmailCapture, ContactForm, ui, icons
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
