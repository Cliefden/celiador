import type { Metadata } from "next";
import { Button, Container, Eyebrow, SectionHeading } from "@/components/ui";
import { EditorMock } from "@/components/EditorMock";
import { iconMap, CheckIcon } from "@/components/icons";
import { features } from "@/lib/site";

export const metadata: Metadata = {
  title: "Features",
  description:
    "A native macOS AI editor with a whole-repo agent, reviewable diffs, and the full VS Code ecosystem.",
};

const deepDives = [
  {
    eyebrow: "The agent",
    title: "It plans, edits, and runs — you review",
    body: "Give Celiador a goal and it breaks it into concrete edits across your files, executes them, and runs your tools to check its work. You see one clean diff and decide what lands.",
    points: [
      "Multi-file, multi-step changes",
      "Runs tests and terminal commands",
      "Explains its reasoning inline",
      "Accept or reject every edit",
    ],
  },
  {
    eyebrow: "The foundation",
    title: "Real VS Code, not a look-alike",
    body: "Celiador is a hard fork of VS Code — the actual Code-OSS source. Your Open VSX extensions, themes, settings, and keybindings work on day one. There's nothing new to learn.",
    points: [
      "Open VSX extension marketplace",
      "Your keybindings and themes",
      "Native performance, offline-first",
      "Familiar command palette & UX",
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[380px] hero-glow" />
        <Container className="relative py-20 text-center sm:py-24">
          <Eyebrow>Features</Eyebrow>
          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Everything in VS Code. Plus an agent that ships.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-fog">
            Celiador brings a first-class AI agent into the editor core — with the full context of
            your codebase and full control in your hands.
          </p>
          <div className="mx-auto mt-12 max-w-4xl text-left">
            <EditorMock />
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      {deepDives.map((d, i) => (
        <section
          key={d.title}
          className={"py-20 " + (i % 2 === 1 ? "border-y border-line bg-surface/30" : "")}
        >
          <Container className="grid items-center gap-12 lg:grid-cols-2">
            <div className={i % 2 === 1 ? "lg:order-2" : ""}>
              <Eyebrow>{d.eyebrow}</Eyebrow>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">{d.title}</h2>
              <p className="mt-4 text-base leading-relaxed text-fog">{d.body}</p>
              <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                {d.points.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-fog">
                    <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className={i % 2 === 1 ? "lg:order-1" : ""}>
              <EditorMock />
            </div>
          </Container>
        </section>
      ))}

      <section className="py-24">
        <Container>
          <SectionHeading
            title="Ready to try it?"
            sub="Download the preview and put the agent to work on your own code."
          />
          <div className="mt-8 flex justify-center">
            <Button href="/download" variant="primary" icon="download" className="px-6 py-3.5">
              Download for Mac
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
