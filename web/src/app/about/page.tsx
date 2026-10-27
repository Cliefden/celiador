import type { Metadata } from "next";
import { Button, Container, Eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "About",
  description: "Why we're building Celiador: work should start as a GitHub issue and end as a pull request you review from wherever you are.",
};

const values = [
  {
    title: "You merge, the agent proposes",
    body: "The agent works on a branch of its own and the result is a pull request. Nothing lands until a person reads it and merges. Speed shouldn't cost you trust.",
  },
  {
    title: "Keep your editor",
    body: "The Celiador editor is the nicest runner, but the loop also works from VS Code and Cursor through the Celiador Remote extension. We would rather meet you where you are than ask you to move.",
  },
  {
    title: "GitHub is the record",
    body: "The run narrates itself on the issue and the pull request closes it. Your team sees what the agent did where they already look, not in a side tool.",
  },
  {
    title: "Your code is yours",
    body: "Runs happen on your machine. We don't train on your code. Privacy is a default, not an upsell.",
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
              Work should start as an issue and end as a pull request.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-fog">
              We started Celiador because the gap between writing down what needs doing and having a
              reviewable change is still too wide. An agent can close it, if it works the way teams
              already do: an issue to brief it, a branch to work on, a pull request to review, and a
              person deciding what ships.
            </p>
          </div>
        </Container>
      </section>

      <section className="pb-8">
        <Container>
          <div className="mx-auto max-w-3xl space-y-5 text-base leading-relaxed text-fog">
            <p>
              The first version of Celiador was a prompt-to-app builder. It hit the wall every
              prompt-to-code tool does: the moment you want to keep editing, the generated code drifts
              away from you. The second was an AI editor, a fork of VS Code with an agent in its core.
              That worked, but it kept us at the desk, watching a chat, for every change.
            </p>
            <p>
              Today Celiador is the loop. You label a GitHub issue <code className="font-mono text-white">celiador</code>;
              an agent runs it on your Mac in its own git worktree, comments on the issue, and opens a
              pull request that closes it; you review and merge from your phone or from the editor&apos;s
              Agents view. The editor is still here, as the nicest runner. VS Code and Cursor run the
              same loop through the Celiador Remote extension. Cloud runs for when your Mac is off are
              being built. It&apos;s the tool we wanted for ourselves, and every change to Celiador now
              ships through it.
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
            We&apos;re a small team. Try the loop on one issue, or say hello.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href="/start" variant="primary" icon="arrow">
              Get started
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
