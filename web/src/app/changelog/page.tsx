import type { Metadata } from "next";
import { Container, Eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What's new in Celiador.",
};

const entries = [
  {
    version: "0.1.0",
    date: "Private preview",
    tag: "Preview",
    items: [
      "First native macOS build, a hard fork of VS Code.",
      "Built-in Celiador agent: chat with your codebase and make multi-file edits.",
      "Reviewable diffs — accept or reject every change.",
      "Open VSX extension marketplace, bring-your-own-key support.",
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
