import Link from "next/link";
import type { Metadata } from "next";
import { Container, Eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What's new in Celiador.",
};

// One entry per thing worth knowing about, newest first. Pricing and plan
// changes always get an entry here, dated, before they take effect (/conduct).
// Builds themselves are listed on /releases, straight from the update feed.
const entries = [
  {
    version: "1.143.0",
    date: "20 Oct 2026",
    tag: "Early access",
    items: [
      "Linux builds: .deb, .rpm and .tar.gz for x86_64 on the download page, with sha256 sums on the releases page. Linux has no in-place updater, so the update check points at the download page.",
      "Import Settings from Another Editor: a command, and a one-time offer on first launch, that brings your settings, keybindings and extension recommendations over from Cursor or VS Code.",
      "Help menu links — documentation, release notes, feature requests and privacy — now go to celiador.ai.",
      "Anonymous product telemetry via TelemetryDeck, limited to a handful of Celiador events and unhandled-error counts, controlled by the standard telemetry setting and described on the privacy page.",
      "The editor core caught up with upstream VS Code, about five weeks of changes.",
    ],
  },
  {
    version: "Pricing",
    date: "17 Oct 2026",
    tag: "Pricing",
    items: [
      "The pricing page previously described a $20 Pro plan, a Teams tier and bring-your-own-key support that did not exist. It now says what is true: Celiador is free during early access.",
      "The per-account limits the server enforces (requests per minute and per day, concurrent requests, input and output tokens per day, model) are published on the pricing page, read live from the same endpoint the app's account panel uses.",
      "Paid plans, when they come, will be announced here with their price, limits and start date before anyone is billed. Early-access accounts will get the transition terms in writing, with an end date.",
    ],
  },
  {
    version: "1.138.0",
    date: "17 Oct 2026",
    tag: "Early access",
    items: [
      "First notarized macOS build: signed with a Developer ID, notarized by Apple, and self-updating. Download it from the download page; later builds install themselves.",
      "iPhone companion: editor-typed turns now appear on the phone; review a run's diff, discard files, commit, push and open a pull request from the phone.",
      "Agent-writable configuration (.vscode settings and tasks, agent settings, git hooks) always needs your approval, in every permission mode.",
      "A second build the same day proved the update path end to end.",
    ],
  },
  {
    version: "0.1.0",
    date: "Sept–Oct 2026",
    tag: "Preview",
    items: [
      "First native macOS build, a hard fork of VS Code.",
      "Built-in Celiador agent: chat with your codebase and make multi-file edits.",
      "Reviewable diffs — accept or reject every change.",
      "Open VSX extension marketplace.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[300px] hero-glow" />
      <Container className="relative py-20 sm:py-24">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <Eyebrow>Changelog</Eyebrow>
            <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              What&apos;s new
            </h1>
            <p className="mt-4 text-lg text-fog">
              Follow along as Celiador ships. Big things are coming fast.
            </p>
            <p className="mt-2 text-sm text-fog">
              Every build, with checksums, is on the{" "}
              <Link href="/releases" className="text-brand hover:underline">
                releases page
              </Link>
              .
            </p>
          </div>

          <div className="mt-14 space-y-10">
            {entries.map((e) => (
              <div key={e.version} className="relative border-l border-line pl-8">
                <span className="absolute -left-2 top-1.5 h-4 w-4 rounded-full border-2 border-brand bg-ink" />
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-xl font-semibold tracking-tight">v{e.version}</h2>
                  <span className="rounded-full border border-line bg-brand/10 px-2.5 py-0.5 text-xs text-brand">
                    {e.tag}
                  </span>
                  <span className="font-mono text-xs text-fog-dim">{e.date}</span>
                </div>
                <ul className="mt-4 space-y-2">
                  {e.items.map((it) => (
                    <li key={it} className="text-sm leading-relaxed text-fog">
                      • {it}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
