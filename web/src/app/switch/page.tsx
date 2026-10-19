import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow } from "@/components/ui";

export const metadata: Metadata = {
  title: "Switching from Cursor",
  description:
    "Move from Cursor or VS Code to Celiador in about a minute: settings, keybindings, snippets and extensions come with you.",
};

// The page for people leaving Cursor. Rules for this page: say what carries over
// and what doesn't, state Celiador's own commitments with links to where they are
// enforced, and never characterise Cursor beyond facts we have verified. No
// comparison tables with numbers we can't stand behind.
export default function SwitchPage() {
  return (
    <Container className="py-20 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <Eyebrow>Switching</Eyebrow>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
          Coming from Cursor? Bring everything.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-fog">
          Celiador is built on VS Code, like Cursor. Your settings, shortcuts, snippets and most of
          your extensions come over in about a minute.
        </p>

        <div className="mt-10 space-y-6 text-sm leading-relaxed text-fog [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc [&_code]:font-mono [&_code]:text-white">
          <h2>Moving over</h2>
          <ol className="space-y-2">
            <li>
              <Link href="/download" className="text-brand hover:underline">
                Download Celiador
              </Link>{" "}
              for macOS or Linux and open it.
            </li>
            <li>
              On first launch Celiador notices Cursor or VS Code on your machine and offers to import.
              Missed it? Run <code>Celiador: Import Settings from Another Editor</code> from the
              command palette.
            </li>
            <li>Sign in, open a folder, and start an agent run.</li>
          </ol>

          <h2>What comes with you</h2>
          <ul className="space-y-2">
            <li>
              <strong className="text-white">Settings</strong> — merged into yours. Anything you
              already set in Celiador wins.
            </li>
            <li>
              <strong className="text-white">Keybindings and snippets</strong> — added, never
              overwriting what you have.
            </li>
            <li>
              <strong className="text-white">Extensions</strong> — installed from{" "}
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
              Cursor&rsquo;s own settings, Cursor-only extensions and Copilot. Celiador has its own
              agent built in; two AI layers in one editor fight each other.
            </li>
            <li>
              Your Cursor account, chat history and indexes. Those stay with Cursor. Celiador
              doesn&rsquo;t build a server-side index of your code at all.
            </li>
          </ul>

          <h2>What&rsquo;s different here</h2>
          <ul className="space-y-2">
            <li>
              <strong className="text-white">Claude is the agent, by design.</strong> Not one option
              in a model menu that can change under you.
            </li>
            <li>
              <strong className="text-white">Your agent runs on your machine, and your phone drives it.</strong>{" "}
              Start a run from the iPhone app on the repo your Mac has open, approve tool calls,
              answer questions, review the diff, commit and open the pull request.
            </li>
            <li>
              <strong className="text-white">One pricing truth.</strong> The limits we enforce are
              published as numbers, live from the same service that meters you —{" "}
              <Link href="/pricing" className="text-brand hover:underline">
                see pricing
              </Link>
              .
            </li>
            <li>
              <strong className="text-white">We never train on your code</strong>, and your code
              stays local —{" "}
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
            do promise how we&rsquo;ll do it — dated notice, grandfathering with an end date, and
            cancelling as easily as you joined. That&rsquo;s written down in our{" "}
            <Link href="/conduct" className="text-brand hover:underline">
              conduct pledge
            </Link>
            , and you can hold us to it.
          </p>

          <div className="mt-12 rounded-2xl border border-line bg-surface p-6 text-center">
            <p className="text-white">Ready when you are.</p>
            <Link
              href="/download"
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-brand px-5 py-3 text-sm font-medium text-white transition hover:brightness-110"
            >
              Download Celiador
            </Link>
          </div>
        </div>
      </div>
    </Container>
  );
}
