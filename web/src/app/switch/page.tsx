import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow } from "@/components/ui";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Coming from Cursor or VS Code",
  description:
    "Keep Cursor or VS Code and add the Celiador Remote extension to get the loop: label a GitHub issue, an agent runs it in a worktree on your Mac, review and merge from your phone. Or move to the Celiador editor and bring your settings.",
};

// The page for people coming from Cursor or VS Code. Rules: say what carries
// over and what doesn't, state Celiador's own commitments with links to where
// they are enforced, and never characterise Cursor beyond facts we have
// verified. No comparison tables with numbers we can't stand behind.
export default function SwitchPage() {
  return (
    <Container className="py-20 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <Eyebrow>Coming from Cursor</Eyebrow>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
          Coming from Cursor? Keep Cursor.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fog">
          Add the Celiador Remote extension and you get the loop: label a GitHub issue{" "}
          <code className="font-mono text-white">celiador</code>, an agent runs it on your Mac in its
          own git worktree, and you review and merge the pull request from your phone. Nothing about
          your editor changes. If you would rather switch to the Celiador editor, your settings come
          with you.
        </p>

        <div className="mt-10 space-y-6 text-sm leading-relaxed text-fog [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_code]:font-mono [&_code]:text-white">
          <h2>Keep your editor: install Celiador Remote</h2>
          <ol className="space-y-2">
            <li>
              In Cursor, search for <strong className="text-white">Celiador Remote</strong> in the
              Extensions view and install it. In VS Code, download the VSIX from the{" "}
              <a href={site.remoteReleases} className="text-brand hover:underline" target="_blank" rel="noreferrer">
                latest release
              </a>{" "}
              and run <code>Extensions: Install from VSIX…</code>. It is also on{" "}
              <a href={site.remoteOpenVsx} className="text-brand hover:underline" target="_blank" rel="noreferrer">
                Open VSX
              </a>
              .
            </li>
            <li>Sign in from the Celiador item in the status bar (email, magic link or GitHub).</li>
            <li>
              Follow the{" "}
              <Link href="/start" className="text-brand hover:underline">
                start guide
              </Link>{" "}
              from step 2: connect GitHub, put the queue on your phone, open the repository, label an
              issue.
            </li>
          </ol>
          <p>
            Runs happen on your machine in a git worktree, the same as in the Celiador editor. The
            extension uses the Claude Code CLI you already have, or downloads it once. Your agent usage
            goes through celiador.ai on our key with your account&rsquo;s limits; an Anthropic key in
            your environment is not used.
          </p>

          <h2>Or move to the Celiador editor</h2>
          <ol className="space-y-2">
            <li>
              <Link href="/download" className="text-brand hover:underline">
                Download Celiador
              </Link>{" "}
              for macOS or Linux and open it.
            </li>
            <li>
              Run <code>Celiador: Import Settings from Another Editor</code> from the command palette.
              It finds Cursor or VS Code on your machine and brings your setup over.
            </li>
            <li>Sign in, open a folder, and label an issue.</li>
          </ol>

          <h2>What comes with you</h2>
          <ul className="space-y-2">
            <li>
              <strong className="text-white">Settings</strong>: merged into yours. Anything you
              already set in Celiador wins.
            </li>
            <li>
              <strong className="text-white">Keybindings and snippets</strong>: added, never
              overwriting what you have.
            </li>
            <li>
              <strong className="text-white">Extensions</strong>: installed from{" "}
              <a href="https://open-vsx.org" className="text-brand hover:underline" target="_blank" rel="noreferrer">
                Open VSX
              </a>
              , the open extension registry. The import tells you by name which ones it could not
              find there.
            </li>
          </ul>

          <h2>What deliberately doesn&rsquo;t</h2>
          <ul className="space-y-2">
            <li>
              Cursor&rsquo;s own settings, Cursor-only extensions and Copilot. The Celiador editor has
              its own agent built in; two AI layers in one editor fight each other.
            </li>
            <li>
              Your Cursor account, chat history and indexes. Those stay with Cursor. Celiador
              doesn&rsquo;t build a server-side index of your code at all.
            </li>
          </ul>

          <h2>What&rsquo;s different here</h2>
          <ul className="space-y-2">
            <li>
              <strong className="text-white">The unit of work is an issue, not a chat.</strong> You
              brief the agent the way you brief a colleague, it works on a branch of its own, and the
              result is a pull request your team can read. The run narrates itself on the issue.
            </li>
            <li>
              <strong className="text-white">The review happens on your phone.</strong> What needs
              you, what is running, what is ready: allow or deny a risky command, answer a question,
              send a follow-up, approve and merge. The editor&rsquo;s Agents view shows the same.
            </li>
            <li>
              <strong className="text-white">Claude is the agent, by design.</strong> Not one option
              in a model menu that can change under you.
            </li>
            <li>
              <strong className="text-white">One pricing truth.</strong> The limits we enforce are
              published as numbers, live from the same service that meters you:{" "}
              <Link href="/pricing" className="text-brand hover:underline">
                see pricing
              </Link>
              .
            </li>
            <li>
              <strong className="text-white">We never train on your code</strong>, and your code
              stays local:{" "}
              <Link href="/privacy" className="text-brand hover:underline">
                privacy, in plain words
              </Link>
              .
            </li>
          </ul>

          <h2>If you&rsquo;re leaving because of billing</h2>
          <p>
            Most developers who switch tools don&rsquo;t leave over features. They leave when a plan
            changes under them, a limit appears that wasn&rsquo;t there before, or a model they relied
            on disappears from the menu. We can&rsquo;t promise we&rsquo;ll never change a price. We
            do promise how we&rsquo;ll do it: dated notice, grandfathering with an end date, and
            cancelling as easily as you joined. That&rsquo;s written down in our{" "}
            <Link href="/conduct" className="text-brand hover:underline">
              conduct pledge
            </Link>
            , and you can hold us to it.
          </p>

          <div className="mt-12 rounded-2xl border border-line bg-surface p-6 text-center">
            <p className="text-white">Ready when you are.</p>
            <div className="mt-4 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/start"
                className="inline-flex items-center justify-center rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white transition hover:brightness-110"
              >
                Get started
              </Link>
              <Link
                href="/download"
                className="inline-flex items-center justify-center rounded-xl border border-line bg-white/[0.03] px-5 py-3 text-sm font-medium text-white transition hover:bg-white/[0.07]"
              >
                Download the editor
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}
