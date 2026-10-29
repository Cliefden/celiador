import Link from "next/link";
import { Button, Container, Eyebrow, SectionHeading } from "@/components/ui";
import { LoopMock, PhoneMock } from "@/components/LoopMock";
import { FAQ } from "@/components/FAQ";
import { EmailCapture } from "@/components/EmailCapture";
import { iconMap, ArrowIcon, CheckIcon, SparkIcon } from "@/components/icons";
import { features, steps, tiers } from "@/lib/site";

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
              Early access · Celiador editor, VS Code or Cursor
            </Eyebrow>
          </div>
          <h1 className="animate-fade-up mx-auto mt-7 max-w-4xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-7xl">
            Issue in,
            <br />
            <span className="gradient-text">pull request out.</span>
          </h1>
          <p className="animate-fade-up mx-auto mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-fog">
            Label a GitHub issue <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[15px] text-white">celiador</code>.
            An agent runs it on your Mac in its own git worktree, opens a pull request that closes the
            issue, and you review and merge from your phone.
          </p>
          <div className="animate-fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/start" variant="primary" icon="arrow" className="px-6 py-3.5">
              Get started
            </Button>
            <Button href="/download" variant="secondary" icon="download" className="px-6 py-3.5">
              Download for Mac
            </Button>
          </div>
          <p className="mt-4 font-mono text-xs text-fog-dim">
            Free in early access · Claude, on our key · Limits published
          </p>
          <p className="mt-4 text-sm text-fog">
            Keeping VS Code or Cursor?{" "}
            <Link href="/switch" className="text-brand hover:underline">
              Add Celiador Remote and you get the loop.
            </Link>
          </p>

          <div className="animate-float mx-auto mt-16 max-w-4xl text-left">
            <LoopMock />
          </div>
        </Container>
      </section>

      {/* ── Trust bar ────────────────────────────────────── */}
      <section className="border-y border-line bg-surface/40">
        <Container className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 py-6 text-sm text-fog-dim">
          <span className="font-mono text-xs uppercase tracking-wider">Fits the tools you already use</span>
          {[
            "GitHub issues and pull requests",
            "A git worktree on your Mac",
            "Celiador editor, VS Code or Cursor",
            "Review on your iPhone",
            "Claude, through our key",
          ].map((t) => (
            <span key={t} className="flex items-center gap-2">
              <CheckIcon className="h-4 w-4 text-brand" />
              {t}
            </span>
          ))}
        </Container>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section id="features" className="py-24">
        <Container>
          <SectionHeading
            eyebrow="What you get"
            title="What happens when you add the label"
            sub="An agent, a worktree, a pull request, and a phone to review it from. The editor is one way to run it, not the point."
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
                  {f.coming && (
                    <p className="mt-3 text-xs leading-relaxed text-fog-dim">
                      <span className="mr-1.5 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide">
                        coming
                      </span>
                      {f.coming}
                    </p>
                  )}
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
            title="Three steps. Two of them are yours."
            sub="You write the issue and you merge the pull request. The agent does the part in between, on a branch of its own."
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
            <Eyebrow>Review from anywhere</Eyebrow>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
              The pull request comes to you.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-fog">
              You don&apos;t have to be at the Mac that ran it. Celiador for iPhone lists what needs
              you, what is running and what is ready for review, with the agent&apos;s account of the
              change and the diff. The same runs sit in the editor&apos;s Agents view, and the issue
              on GitHub carries the record: picked up, the branch, the pull request.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "What the agent did, the diff, and what needs you, on your phone",
                "A follow-up starts another turn on the same branch",
                "Allow or deny a risky command without opening a laptop",
                "Approve and merge from the phone; the editor merges with your GitHub sign-in",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3 text-sm text-fog">
                  <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Button href="/start" variant="secondary" icon="arrow">
                Read the start guide
              </Button>
            </div>
          </div>
          <div className="lg:pl-4">
            <PhoneMock />
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
            <SparkIcon className="h-7 w-7" />
          </div>
          <h2 className="mx-auto mt-6 max-w-2xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Start with one issue.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-fog">
            Pick a runner, label an issue, and review the pull request from your phone. About ten
            minutes from install to the first merge.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/start" variant="primary" icon="arrow" className="px-6 py-3.5">
              Get started
            </Button>
            <Button href="/download" variant="secondary" icon="download" className="px-6 py-3.5">
              Download for Mac
            </Button>
          </div>
          <div className="mt-8">
            <EmailCapture subject="Celiador for Windows" hint="Need the editor on Windows? One email when it ships." />
          </div>
        </Container>
      </section>
    </>
  );
}
