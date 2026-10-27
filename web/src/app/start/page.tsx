import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow } from "@/components/ui";
import { publishedLimits } from "@/lib/limits";
import { latestMacDmgHref, latestMacRelease } from "@/lib/releases";

export const metadata: Metadata = {
  title: "Your first agent pull request",
  description:
    "From nothing to a merged agent pull request in about ten minutes: pick a runner (Celiador editor, or VS Code and Cursor with Celiador Remote), sign in, connect GitHub, label an issue, review and merge from your phone.",
};

// The page an outside developer gets sent. Every step below was exercised on a
// clean profile in the loop tests (Oct 2026); the two preconditions people miss
// — a GitHub sign-in for the pull request and a repository linked from the phone
// — are called out as steps of their own, not footnotes. Keep it to one screen
// per step and say what the person will see. Step 1 names the three runners;
// the cloud one is in progress and must stay marked as such until it is live.
const steps: { id: string; title: string; minutes: number }[] = [
  { id: "install", title: "Pick a runner and sign in", minutes: 2 },
  { id: "github", title: "Connect GitHub", minutes: 2 },
  { id: "phone", title: "Put the queue on your phone", minutes: 2 },
  { id: "repo", title: "Open the repository and watch it", minutes: 1 },
  { id: "issue", title: "Label an issue", minutes: 1 },
  { id: "review", title: "Review and merge from the phone", minutes: 2 },
];

export default async function StartPage() {
  const [release, limits] = await Promise.all([latestMacRelease(), publishedLimits()]);

  return (
    <Container className="py-20 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <Eyebrow>Start here</Eyebrow>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
          Your first agent pull request, in about ten minutes
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fog">
          Celiador turns a GitHub issue into a pull request while you are away from the keyboard:
          you label the issue, an agent runs it on your Mac in its own git worktree, and you review and
          merge from your phone. The agent needs a runner on your Mac; the Celiador editor is one,
          VS Code or Cursor with the Celiador Remote extension is another. This page gets you from
          nothing to that first merge with either.
        </p>

        <ol className="mt-8 grid gap-2 sm:grid-cols-2">
          {steps.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="flex items-center justify-between rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-sm text-fog hover:text-white">
                <span>
                  <span className="mr-2 font-mono text-xs text-fog-dim">{i + 1}</span>
                  {s.title}
                </span>
                <span className="font-mono text-xs text-fog-dim">{s.minutes} min</span>
              </a>
            </li>
          ))}
        </ol>

        <div className="mt-10 space-y-6 text-sm leading-relaxed text-fog [&_h2]:mt-12 [&_h2]:scroll-mt-24 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-white [&_code]:rounded [&_code]:bg-white/[0.06] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-white [&_li]:ml-5 [&_li]:list-decimal">
          <h2 id="install">1. Pick a runner and sign in</h2>
          <p>
            A runner is the program on your Mac that does the work when an issue is labelled. There are
            three; pick one.
          </p>
          <h3 className="mt-6 font-semibold text-white">The Celiador editor</h3>
          <p>
            The loop built into a VS Code fork, with an Agents view that shows every run. You need an Apple
            Silicon Mac (macOS 13 or later) or Linux x86_64.{" "}
            <a href={latestMacDmgHref} className="text-brand hover:underline">Download the macOS DMG</a>
            {release ? ` (version ${release.productVersion})` : ""} or pick a Linux package on the{" "}
            <Link href="/download" className="text-brand hover:underline">download page</Link>. Open it, drag
            Celiador to Applications, and start it from there. On first launch, click{" "}
            <strong className="text-white">Sign in</strong> on the welcome view (or the account item in the
            status bar) and create an account with an email and password. That one account is shared by the
            editor, the phone app and the hosted agent; there is no API key to paste.
          </p>
          <p>
            Coming from Cursor or VS Code? Run <code>Celiador: Import Settings from Another Editor</code> from
            the command palette to bring your settings, keybindings and extensions over; the{" "}
            <Link href="/switch" className="text-brand hover:underline">switching page</Link> says what
            carries over.
          </p>
          <h3 className="mt-6 font-semibold text-white">VS Code or Cursor, with Celiador Remote</h3>
          <p>
            Keep your editor and install the{" "}
            <a href="https://open-vsx.org/extension/celiador/celiador-remote" className="text-brand hover:underline">Celiador Remote</a>{" "}
            extension. In Cursor, search for it in the Extensions view; in VS Code, download the VSIX from the{" "}
            <a href="https://github.com/Cliefden/celiador-remote/releases/latest" className="text-brand hover:underline">latest release</a>{" "}
            and run <strong className="text-white">Extensions: Install from VSIX…</strong>. Sign in from its
            status bar item, then follow the same steps 2 to 6. Runs happen on your machine in a git
            worktree, the same way; the extension uses the Claude Code CLI you have installed, or downloads it once.
            Without the Celiador editor you review in the phone app rather than an Agents view.
          </p>
          <h3 className="mt-6 font-semibold text-white">The cloud (being built)</h3>
          <p>
            A run that starts even when your Mac is off, on a server of ours, on a clone of the repository.
            It is being built and is not live yet. It will need the Celiador GitHub App installed on the
            repository (step 2), since the push and the pull request happen without your machine. Until then,
            a labelled issue waits in the queue until a runner of yours is online.
          </p>

          <h2 id="github">2. Connect GitHub</h2>
          <p>
            Two things talk to GitHub on your behalf, and both need a sign-in that most developers already
            have:
          </p>
          <ol className="space-y-2">
            <li>
              <strong className="text-white">The editor</strong> pushes the agent&apos;s branch and opens the
              pull request. It uses your git credentials for the push and, for the pull request, either the
              editor&apos;s GitHub sign-in (the Accounts menu in the activity bar) or the GitHub CLI if you
              have run <code>gh auth login</code> on that Mac. Without either you get a compare link instead
              of a pull request, so do this before the first run.
            </li>
            <li>
              <strong className="text-white">The Celiador GitHub App</strong> hears about labelled issues,
              comments on them as <code>celiador</code> when a run starts, and notices when the pull request
              is merged. Install it on the repositories you want agents to work on:{" "}
              <a href="https://github.com/apps/celiador/installations/new" className="text-brand hover:underline" target="_blank" rel="noreferrer">
                github.com/apps/celiador
              </a>
              . It asks for issues, pull requests and contents on those repositories, nothing else.
            </li>
          </ol>

          <h2 id="phone">3. Put the queue on your phone</h2>
          <p>
            The iPhone app is the review surface: what needs you, what is running, the pull requests
            waiting, and a merge button. It is distributed through TestFlight. Until the public link is on
            the download page, ask for an invite from the{" "}
            <Link href="/contact" className="text-brand hover:underline">contact page</Link> and mention your
            Apple ID email. Install it, sign in with the same account as the editor, and you are on the{" "}
            <strong className="text-white">Queue</strong> tab.
          </p>
          <p>
            No phone yet? Everything on the phone is also in the editor&apos;s Agents window (<code>Open Agents
            Window</code> from the Command Palette); you only lose the away-from-desk part.
          </p>

          <h2 id="repo">4. Open the repository and watch it</h2>
          <p>
            On the Mac, open the repository folder in Celiador (a normal clone with a GitHub remote) and
            trust it when asked. The editor tells the queue which repositories it has open. On the phone,
            tap the eye on the Queue tab and switch the repository on under{" "}
            <strong className="text-white">Watched repos</strong>. That link is what routes issues from that
            repository to your account; one account per repository.
          </p>

          <h2 id="issue">5. Label an issue</h2>
          <p>
            Write an issue the way you would brief a colleague for a small change: what to change, where,
            what not to touch. Create a label named <code>celiador</code> if the repository does not have one,
            and add it to the issue (or comment <code>@celiador</code> as a collaborator). Within a minute or
            two:
          </p>
          <ol className="space-y-2">
            <li>the issue gets a comment from <code>celiador</code> saying it was picked up and on which branch;</li>
            <li>the run appears under <strong className="text-white">Running</strong> on the phone, and in the editor&apos;s Agents window, in its own worktree so your working copy is untouched;</li>
            <li>the agent reads, edits, runs lint and tests, and commits. Routine commands run on their own; a risky one shows up under <strong className="text-white">Needs you</strong> with Allow and Deny;</li>
            <li>when it finishes, the editor pushes the branch and opens a pull request that closes the issue.</li>
          </ol>
          <p>
            Re-adding a label the issue already has does nothing; remove it and add it again to re-run.
            Up to {limits.tasks.concurrency} runs go at once per account; the rest wait in the queue.
          </p>

          <h2 id="review">6. Review and merge from the phone</h2>
          <p>
            The pull request shows under <strong className="text-white">Ready for review</strong>. Tap it to
            read the diff, discard a file, or send a follow-up that starts another turn on the same branch.
            Swipe the row to <strong className="text-white">Merge</strong>: your runner merges it with your
            GitHub sign-in and the task moves to merged. That is the loop. The account panel keeps count of
            pull requests merged in the last seven days; it is the one number we steer the product by.
          </p>
          <p>
            Being built, in the same release cycle: the agent&apos;s plan and its questions posted on the
            issue, so you can answer by replying there; failed CI checks picked up and fixed by the agent; the
            cost of each run shown on the pull request and on the card; and a self-review section in every
            pull request. None of that is live yet; when it is, it appears in the{" "}
            <Link href="/changelog" className="text-brand hover:underline">changelog</Link> first.
          </p>

          <h2 id="after">When something goes wrong</h2>
          <ol className="space-y-2">
            <li><strong className="text-white">The pull request is a compare link.</strong> The editor had no GitHub sign-in; see step 2.</li>
            <li><strong className="text-white">Nothing happens after the label.</strong> The app is not installed on that repository (step 2) or the repository is not watched from the phone (step 4). A runner must also be online with the folder open: the Celiador editor, or VS Code or Cursor with Celiador Remote.</li>
            <li><strong className="text-white">The run failed.</strong> The task shows the error on the phone. Our limits are published and enforced per account; the current ones are on the <Link href="/pricing" className="text-brand hover:underline">pricing page</Link>.</li>
            <li><strong className="text-white">Anything else.</strong> <a href="https://github.com/Cliefden/celiador-editor/issues/new" className="text-brand hover:underline" target="_blank" rel="noreferrer">Open an issue</a> or write to the <Link href="/contact" className="text-brand hover:underline">contact page</Link>; a person answers.</li>
          </ol>
          <p className="text-xs text-fog-dim">
            The code is open source (Apache-2.0): the{" "}
            <a href="https://github.com/Cliefden/celiador-editor" className="underline hover:text-fog" target="_blank" rel="noreferrer">editor</a>,{" "}
            the <a href="https://github.com/Cliefden/daemon" className="underline hover:text-fog" target="_blank" rel="noreferrer">server</a> and{" "}
            the <a href="https://github.com/Cliefden/celiador-ios" className="underline hover:text-fog" target="_blank" rel="noreferrer">iPhone app</a>. What we do with your code and data is on the{" "}
            <Link href="/privacy" className="underline hover:text-fog">privacy page</Link>.
          </p>
        </div>
      </div>
    </Container>
  );
}
