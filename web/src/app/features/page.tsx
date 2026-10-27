import type { Metadata } from "next";
import { Button, Container, Eyebrow, SectionHeading } from "@/components/ui";
import { EditorMock } from "@/components/EditorMock";
import { IssueMock, LoopMock, PhoneMock } from "@/components/LoopMock";
import { iconMap, CheckIcon } from "@/components/icons";
import { features } from "@/lib/site";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Issue in, pull request out: the loop, the three runners (Celiador editor, VS Code or Cursor with Celiador Remote, the cloud), review from your phone, and what is still being built.",
};

// Each deep dive says what works today and marks what is in progress with a
// "coming" tag. Do not move an item out of `coming` until it is live.
const deepDives: {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  coming?: string[];
  mock: "editor" | "phone" | "issue";
}[] = [
  {
    eyebrow: "The runners",
    title: "Pick where the agent runs",
    body: "The loop is the same wherever it runs: a git worktree on a fresh branch, your project's own agent settings, your git identity for the push, your GitHub sign-in for the pull request. Choose the runner that fits how you work.",
    points: [
      "Celiador editor: the loop built in, with the Agents view as the cockpit for every run",
      "VS Code or Cursor: install the Celiador Remote extension and keep your editor",
      "Both run on your Mac; your checkout is never touched",
      "One account across the runners and the phone",
    ],
    coming: ["Cloud runs for when your Mac is off. They need the Celiador GitHub App on the repository."],
    mock: "editor",
  },
  {
    eyebrow: "The review",
    title: "Review it where you are",
    body: "Celiador for iPhone is the queue: what needs you, what is running, what is ready for review. Open a pull request to read the agent's account and the diff, send a follow-up for another turn on the same branch, and approve and merge. The editor's Agents view shows the same runs for when you are at the desk.",
    points: [
      "Allow or deny a risky command; routine ones run on their own",
      "Answer the agent's questions from the phone",
      "Follow-ups keep the branch and the context",
      "Merge from the phone; the editor does it with your GitHub sign-in",
    ],
    mock: "phone",
  },
  {
    eyebrow: "The record",
    title: "GitHub carries the story",
    body: "Nothing about a run is hidden in a side tool. The issue gets a comment when the run is picked up and on which branch, and the pull request link when it is done. The pull request closes the issue and says what the agent did.",
    points: [
      "Picked-up and pull-request comments on the issue, from the Celiador GitHub App",
      "The pull request closes the issue it came from",
      "Your team reads the work where they already look",
    ],
    coming: [
      "The agent's plan and questions posted on the issue, answered by replying there",
      "A self-review section in every pull request: what changed, what it is unsure about, what it did not run",
      "Per-run cost on the pull request and on the card",
      "Failed CI checks picked up and fixed by the agent",
    ],
    mock: "issue",
  },
];

function Mock({ kind }: { kind: "editor" | "phone" | "issue" }) {
  if (kind === "phone") {
    return <PhoneMock />;
  }
  if (kind === "issue") {
    return <IssueMock />;
  }
  return <EditorMock />;
}

export default function FeaturesPage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[380px] hero-glow" />
        <Container className="relative py-20 text-center sm:py-24">
          <Eyebrow>Features</Eyebrow>
          <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            The loop, piece by piece.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-fog">
            A GitHub issue goes in, a pull request comes out. Here is each part, and which parts are
            still being built.
          </p>
          <div className="mx-auto mt-12 max-w-4xl text-left">
            <LoopMock />
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
              <ul className="mt-6 grid gap-3">
                {d.points.map((p) => (
                  <li key={p} className="flex items-start gap-2.5 text-sm text-fog">
                    <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                    {p}
                  </li>
                ))}
              </ul>
              {d.coming && (
                <ul className="mt-4 grid gap-2">
                  {d.coming.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm text-fog-dim">
                      <span className="mt-0.5 shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide">
                        coming
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={i % 2 === 1 ? "lg:order-1" : ""}>
              <Mock kind={d.mock} />
            </div>
          </Container>
        </section>
      ))}

      <section className="py-24">
        <Container>
          <SectionHeading
            title="Start with one issue"
            sub="Pick a runner, label an issue, review the pull request from your phone. The start guide takes about ten minutes."
          />
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/start" variant="primary" icon="arrow" className="px-6 py-3.5">
              Get started
            </Button>
            <Button href="/download" variant="secondary" icon="download" className="px-6 py-3.5">
              Download for Mac
            </Button>
          </div>
        </Container>
      </section>
    </>
  );
}
