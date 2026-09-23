import type { Metadata } from "next";
import { Button, Container, Eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "About",
  description: "Why we're building Celiador — a native AI editor for people who ship.",
};

const values = [
  {
    title: "You stay in control",
    body: "AI should propose, not overwrite. Every change Celiador makes is a diff you review. Speed shouldn't cost you trust.",
  },
  {
    title: "Meet people where they are",
    body: "Developers already live in VS Code. Instead of inventing a new editor, we brought the agent to the one you know.",
  },
  {
    title: "Native beats a browser tab",
    body: "Your editor is where you spend your day. It deserves to be a fast, first-class app on your Mac — not a website pretending to be one.",
  },
  {
    title: "Your code is yours",
    body: "We don't train on your code. Privacy is a default, not an upsell.",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[360px] hero-glow" />
        <Container className="relative py-20 sm:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <Eyebrow>About</Eyebrow>
            <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              Software should feel like describing what you want.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-fog">
              We started Celiador because the gap between having an idea and shipping it is still too
              wide. AI can close it — but only if it works the way developers actually do: inside a
              real editor, with real context, and with a human deciding what ships.
            </p>
          </div>
        </Container>
      </section>

      <section className="pb-8">
        <Container>
          <div className="mx-auto max-w-3xl space-y-5 text-base leading-relaxed text-fog">
            <p>
              The first version of Celiador was a prompt-to-app builder. It was fun, but it hit the
              same wall every prompt-to-code tool does: the moment you want to keep editing, the
              generated code drifts away from you. So we rebuilt it around a simple belief — the best
              place for an AI agent is right next to your code, in the editor you already trust.
            </p>
            <p>
              Today Celiador is a native macOS editor, a hard fork of VS Code, with an agent built
              into its core. It reads your whole repository, makes multi-file changes, and shows you
              every diff before anything lands. It&apos;s the tool we wanted for ourselves.
            </p>
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div className="grid gap-4 sm:grid-cols-2">
            {values.map((v) => (
              <div key={v.title} className="card rounded-2xl p-7">
                <h3 className="text-lg font-semibold tracking-tight">{v.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fog">{v.body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-t border-line py-24 text-center">
        <Container>
          <h2 className="mx-auto max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Come build with us.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-fog">
            We&apos;re a small team shipping fast. Try the preview or say hello.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/download" variant="primary" icon="download">
              Download for Mac
            </Button>
            <Button href="/contact" variant="secondary" icon="arrow">
              Get in touch
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
