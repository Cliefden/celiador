import Link from "next/link";
import { Button, Container, Eyebrow, SectionHeading } from "@/components/ui";
import { EditorMock } from "@/components/EditorMock";
import { FAQ } from "@/components/FAQ";
import { EmailCapture } from "@/components/EmailCapture";
import { iconMap, AppleIcon, ArrowIcon, CheckIcon, SparkIcon } from "@/components/icons";
import { features, steps, site, tiers } from "@/lib/site";

export default function HomePage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 grid-bg" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] hero-glow" />
        <Container className="relative pt-20 pb-16 text-center sm:pt-28">
          <div className="animate-fade-up">
            <Eyebrow>
              <SparkIcon className="h-3.5 w-3.5 text-brand" />
              Now in private preview
            </Eyebrow>
          </div>
          <h1 className="animate-fade-up mx-auto mt-7 max-w-4xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
            The AI editor for
            <br />
            <span className="gradient-text">people who ship.</span>
          </h1>
          <p className="animate-fade-up mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-fog">
            Celiador is a native macOS code editor with an agent built into its core. Describe the
            change — it reads your repo, edits across files, and hands you a diff to review. Built on
            VS Code, so everything you already know comes with you.
          </p>
          <div className="animate-fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/download" variant="primary" icon="download" className="px-6 py-3.5">
              Download for Mac
            </Button>
            <Button href="/features" variant="secondary" icon="arrow" className="px-6 py-3.5">
              See what it does
            </Button>
          </div>
          <p className="mt-4 font-mono text-xs text-fog-dim">
            {site.minMacOS} · Free to start
          </p>

          <div className="animate-float mx-auto mt-16 max-w-4xl text-left">
            <EditorMock />
          </div>
        </Container>
      </section>

      {/* ── Trust bar ────────────────────────────────────── */}
      <section className="border-y border-line bg-surface/40">
        <Container className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-6 text-sm text-fog-dim">
          <span className="font-mono text-xs uppercase tracking-wider">Built for the way you already work</span>
          {["VS Code core", "Open VSX extensions", "Your keybindings", "Your themes", "Apple Silicon"].map(
            (t) => (
              <span key={t} className="flex items-center gap-2">
                <CheckIcon className="h-4 w-4 text-brand" />
                {t}
              </span>
            ),
          )}
        </Container>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section id="features" className="py-24">
        <Container>
          <SectionHeading
            eyebrow="Features"
            title="An editor that does the work with you"
            sub="Not autocomplete. A real agent that understands your whole codebase and makes changes you stay in control of."
          />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => {
              const Icon = iconMap[f.icon];
              return (
                <div key={f.title} className="card card-hover rounded-2xl p-6">
                  <div className="grid h-11 w-11 place-items-center rounded-xl border border-line bg-brand/10 text-brand">
                    {Icon ? <Icon className="h-5 w-5" /> : null}
                  </div>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-fog">{f.body}</p>
                </div>
              );
            })}
          </div>
        </Container>
      </section>

      {/* ── How it works ─────────────────────────────────── */}
      <section className="border-t border-line bg-surface/30 py-24">
        <Container>
          <SectionHeading
            eyebrow="How it works"
            title="From idea to merged, in three steps"
            sub="The agent proposes; you decide. Every change is a reviewable diff — never a silent rewrite."
          />
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <div key={s.title} className="relative rounded-2xl border border-line bg-surface p-7">
                <span className="font-mono text-sm text-brand">0{i + 1}</span>
                <h3 className="mt-3 text-xl font-semibold tracking-tight">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fog">{s.body}</p>
                {i < steps.length - 1 && (
                  <ArrowIcon className="absolute -right-4 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-line md:block" />
                )}
              </div>
            ))}
          </div>
        </Container>
      </section>

      {/* ── Split showcase ───────────────────────────────── */}
      <section className="py-24">
        <Container className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <Eyebrow>Whole-repo context</Eyebrow>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
              It reads everything, so you don&apos;t have to explain everything.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-fog">
              Point Celiador at any repository and it builds a live understanding of your code —
              modules, types, conventions, and how it all fits. Ask a question, request a change, or
              hand it a bug; it works with the full picture, not just the file you have open.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Multi-file edits with a single reviewable diff",
                "Runs your scripts, tests, and terminal commands",
                "Understands your project's patterns and reuses them",
                "Keeps your extensions, themes, and shortcuts",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm text-fog">
                  <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Button href="/features" variant="secondary" icon="arrow">
                Explore all features
              </Button>
            </div>
          </div>
          <div className="lg:pl-4">
            <EditorMock />
          </div>
        </Container>
      </section>

      {/* ── Pricing preview ──────────────────────────────── */}
      <section className="border-t border-line bg-surface/30 py-24">
        <Container>
          <SectionHeading
            eyebrow="Pricing"
            title="Free while we're in early access."
            sub="The hosted agent runs on our key, with per-account limits we publish and enforce. Paid plans get a dated announcement before anyone is billed."
          />
          <div className="mt-14 grid gap-4 lg:grid-cols-3">
            {tiers.map((t) => (
              <div
                key={t.name}
                className={
                  "relative rounded-2xl border p-7 " +
                  (t.featured ? "border-brand/50 bg-brand/[0.06] ring-brand" : "border-line bg-surface")
                }
              >
                {t.featured && (
                  <span className="absolute right-6 top-6 rounded-full bg-brand px-2.5 py-1 text-xs font-medium text-white">
                    Popular
                  </span>
                )}
                <h3 className="text-lg font-semibold">{t.name}</h3>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight">{t.price}</span>
                  {t.cadence && <span className="text-sm text-fog-dim">{t.cadence}</span>}
                </div>
                <p className="mt-3 text-sm text-fog">{t.blurb}</p>
                <div className="mt-6">
                  <Button
                    href={t.href}
                    variant={t.featured ? "primary" : "secondary"}
                    className="w-full"
                  >
                    {t.cta}
                  </Button>
                </div>
                <ul className="mt-6 space-y-2.5">
                  {t.perks.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm text-fog">
                      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-fog-dim">
            Full comparison on the{" "}
            <Link href="/pricing" className="text-brand hover:underline">
              pricing page
            </Link>
            .
          </p>
        </Container>
      </section>

      {/* ── FAQ ──────────────────────────────────────────── */}
      <section className="py-24">
        <Container>
          <SectionHeading eyebrow="FAQ" title="Questions, answered" />
          <FAQ />
        </Container>
      </section>

      {/* ── Final CTA ────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-line py-24">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-full hero-glow" />
        <Container className="relative text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-line bg-brand/10 text-brand">
            <AppleIcon className="h-7 w-7" />
          </div>
          <h2 className="mx-auto mt-6 max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Ship your next idea with Celiador.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-fog">
            The macOS app is here — signed, notarized, and self-updating. Windows and Linux: say
            the word and we&apos;ll tell you when yours ships.
          </p>
          <div className="mt-8 flex justify-center">
            <Button href="/download" variant="primary" icon="download" className="px-6 py-3.5">
              Download for Mac
            </Button>
          </div>
          <div className="mt-8">
            <EmailCapture subject="Celiador for Windows / Linux" hint="Tell us which platform you need; one email when it ships." />
          </div>
        </Container>
      </section>
    </>
  );
}
