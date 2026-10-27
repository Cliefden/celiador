import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow } from "@/components/ui";
import { formatLimit, publishedLimits } from "@/lib/limits";
import { latestMacDmgHref, latestMacRelease } from "@/lib/releases";

export const metadata: Metadata = {
  title: "Docs",
  description: "Getting started with Celiador: the loop, the runners, install, sign in, the agent, the iPhone companion, Workspace Trust, limits, updates and your data.",
};

const sections: { id: string; title: string }[] = [
  { id: "loop", title: "The loop" },
  { id: "install", title: "Install" },
  { id: "sign-in", title: "Sign in" },
  { id: "agent", title: "The agent" },
  { id: "phone", title: "iPhone companion" },
  { id: "workspace-trust", title: "Workspace Trust" },
  { id: "limits", title: "Limits" },
  { id: "updates", title: "Updates" },
  { id: "data", title: "Your data" },
  { id: "support", title: "Support" },
];

// The editor's Help ▸ Documentation and its Workspace Trust walkthrough step
// link here (product.json documentationUrl, /docs#workspace-trust), so the
// anchors above are part of the contract with the app.
export default async function DocsPage() {
  const [release, limits] = await Promise.all([latestMacRelease(), publishedLimits()]);

  return (
    <Container className="py-20 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <Eyebrow>Docs</Eyebrow>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">Getting started</h1>
        <p className="mt-4 text-lg text-fog">
          Everything you need for the first hour with Celiador. Short on purpose; the loop is three
          steps, and the editor itself is VS Code, so what you already know still applies.
        </p>
        <p className="mt-4 text-fog">
          New here? Follow the{" "}
          <Link href="/start" className="text-brand hover:underline">start guide</Link>; it ends with
          your first merged agent pull request.
        </p>

        <nav className="mt-8 flex flex-wrap gap-2">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="rounded-full border border-line bg-white/[0.02] px-3 py-1 text-xs text-fog hover:text-white">
              {s.title}
            </a>
          ))}
        </nav>

        <div className="mt-10 space-y-6 text-sm leading-relaxed text-fog [&_h2]:mt-10 [&_h2]:scroll-mt-24 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-white [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-white [&_code]:rounded [&_code]:bg-white/[0.06] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-white [&_kbd]:rounded [&_kbd]:border [&_kbd]:border-line [&_kbd]:bg-white/[0.04] [&_kbd]:px-1.5 [&_kbd]:py-0.5 [&_kbd]:font-mono [&_kbd]:text-[12px] [&_kbd]:text-white">
          <h2 id="loop">The loop</h2>
          <p>
            Label a GitHub issue <code>celiador</code> on a repository you have linked from the phone. A
            runner on your Mac picks it up, creates a git worktree on a fresh branch so your checkout is
            untouched, and runs a Claude agent there. The issue gets a comment saying it was picked up and on
            which branch. When the agent is done, the runner pushes the branch and opens a pull request that
            closes the issue; the issue gets the link. You review the diff on the phone or in the
            editor&apos;s Agents view, send a follow-up if it needs another turn, and approve and merge.
          </p>
          <p>
            Runners: the Celiador editor (below), or VS Code and Cursor with the{" "}
            <a href="https://open-vsx.org/extension/celiador/celiador-remote" className="text-brand hover:underline">Celiador Remote</a>{" "}
            extension. Cloud runs for when your Mac is off are being built and will need the Celiador GitHub
            App on the repository. Routine commands run on their own; a risky command or a question waits for
            you under <strong className="text-white">Needs you</strong>, with Allow and Deny. The{" "}
            <Link href="/start" className="text-brand hover:underline">start guide</Link> walks through the
            GitHub App, the phone and the first issue.
          </p>

          <h2 id="install">Install</h2>
          <p>
            The Celiador editor runs on Apple Silicon Macs with macOS 13 or later, and on Linux x64.{" "}
            <a href={latestMacDmgHref} className="text-brand hover:underline">Download the DMG</a>
            {release ? ` (version ${release.productVersion})` : ""}, open it, drag Celiador to Applications,
            and open it from there. The app is signed with a Developer ID and notarized by Apple: you&apos;ll
            see macOS&apos;s standard &ldquo;downloaded from the internet&rdquo; confirmation once, and nothing
            else. Every build we ship, with checksums, is on the{" "}
            <Link href="/releases" className="text-brand hover:underline">releases page</Link>.
          </p>
          <p>
            Linux packages (.deb, .rpm, .tar.gz) are on the{" "}
            <Link href="/download" className="text-brand hover:underline">download page</Link>; Windows is on
            the roadmap and the same page has a notify-me form for it. Keeping VS Code or Cursor? Install
            Celiador Remote instead; the <Link href="/switch" className="text-brand hover:underline">switching page</Link>{" "}
            has the steps.
          </p>

          <h2 id="sign-in">Sign in</h2>
          <p>
            The first launch opens a welcome view with a <strong className="text-white">Sign in</strong>{" "}
            button (it&apos;s also the account item in the status bar, and the command{" "}
            <code>Celiador: Sign In</code>). Pick email and password, a magic link, or GitHub. A magic
            link must be opened on the same Mac within ten minutes; it hands you straight back into the
            editor. Your account is what the hosted agent and the iPhone companion share.
          </p>

          <h2 id="agent">The agent in the editor</h2>
          <p>
            Claude is built into the editor and runs through our server; there is no key to paste
            and no extension to install. Labelled issues run through it without you doing anything (see
            the loop above). The first chat downloads the agent runtime (about a minute), then three
            surfaces are yours for work you start yourself:
          </p>
          <h3>Chat</h3>
          <p>
            <kbd>⌃⌘I</kbd> opens the chat view (or the chat icon in the title bar). Ask about the
            codebase, or ask for a change: the agent plans, edits across files, runs your tools, and
            every write is a diff you accept or reject. Attach files with <code>#file:</code> or Add
            Context; the active editor is forwarded automatically.
          </p>
          <h3>Inline edit</h3>
          <p>
            <kbd>⌘I</kbd> in a file edits the selection or the file in place and shows the result as
            inline hunks: <kbd>⌘Y</kbd> keeps, <kbd>⌘N</kbd> undoes. <kbd>⌘I</kbd> in the terminal
            asks for a command and offers to run or insert it; it never runs on its own.
          </p>
          <h3>Agents window</h3>
          <p>
            <code>Open Agents Window</code> from the Command Palette is the cockpit: the queue of labelled
            issues and several runs side by side, each with its transcript, tool calls and diff. These are
            the same sessions the iPhone app watches, and the pull requests can be reviewed and merged here
            as well as on the phone.
          </p>

          <h2 id="phone">iPhone companion</h2>
          <p>
            The companion app is the review surface for the loop: what needs you, what is running, and
            the pull requests ready for review, from every runner on your account. Read the agent&apos;s
            account of the change and the diff, send follow-ups, allow or deny a tool call, answer the
            agent&apos;s questions, cancel, browse and edit files of the session, discard files, and approve
            and merge the pull request, without touching the laptop. &ldquo;From your editor&rdquo; lists the
            repositories your Mac has open, so a run can also start from the phone on the local working
            copy; no cloning, no tokens. Distribution is through TestFlight; the link appears on the
            download page when it&apos;s live.
          </p>

          <h2 id="workspace-trust">Workspace Trust</h2>
          <p>
            A repository can carry settings, tasks and agent hooks that execute code. Celiador keeps
            VS Code&apos;s Workspace Trust on: a folder you haven&apos;t trusted opens in Restricted Mode,
            where its settings are filtered and its tasks don&apos;t run, and the agent will not start in
            it until you trust it. Trust is per folder and you can review or revoke it at any time
            (<code>Workspaces: Manage Workspace Trust</code>).
          </p>
          <p>
            Even in a trusted folder, the agent cannot change what the editor or the agent itself
            executes without your explicit approval: edits to <code>.vscode/*.json</code>, agent settings
            under <code>.claude/</code>, git hooks and similar files always prompt, in every permission
            mode, including after you approved a plan.
          </p>

          <h2 id="limits">Limits</h2>
          <p>
            The hosted agent runs on our key with per-account limits that the server enforces and
            the app shows you in its account panel. The current numbers, live from the same endpoint:
          </p>
          <table className="w-full text-sm">
            <tbody>
              {[
                ["Agent requests per minute", formatLimit(limits.limits.rpm)],
                ["Concurrent agent requests", formatLimit(limits.limits.concurrency)],
                ["Agent requests per day (UTC)", formatLimit(limits.limits.dailyRequests)],
                ["Input tokens per day (UTC)", formatLimit(limits.limits.dailyInput)],
                ["Output tokens per day (UTC)", formatLimit(limits.limits.dailyOutput)],
                ["Model", limits.model],
              ].map(([k, v]) => (
                <tr key={k} className="border-b border-line last:border-b-0">
                  <td className="py-2 pr-4 text-white">{k}</td>
                  <td className="py-2 text-right font-mono text-white">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-fog-dim">
            {limits.live ? "Live from celiador.ai/api/limits." : "Documented defaults; the live endpoint was unreachable when this page was built."}{" "}
            Why we publish them: the <Link href="/conduct" className="underline hover:text-fog">conduct pledge</Link>.
          </p>

          <h2 id="updates">Updates</h2>
          <p>
            The app checks celiador.ai for a newer build on its own, downloads it in the background,
            and offers a restart; <code>Celiador: Check for Updates</code> does it on demand. Each build is
            notarized before it&apos;s published, and the{" "}
            <Link href="/changelog" className="text-brand hover:underline">changelog</Link> says what changed.
          </p>

          <h2 id="data">Your data</h2>
          <p>
            Your code stays on your machine; the agent reads what it needs for a request and nothing
            is indexed server-side. Your code is never used to train models. The server stores your
            account, chat history and push registrations so the phone and the editor see the same
            sessions; deleting your account removes all of it. Details in the{" "}
            <Link href="/privacy" className="text-brand hover:underline">privacy policy</Link>.
          </p>

          <h2 id="support">Support</h2>
          <p>
            A person answers. Write to{" "}
            <a href="mailto:hello@celiador.ai" className="text-brand hover:underline">hello@celiador.ai</a>{" "}
            or use the <Link href="/contact" className="text-brand hover:underline">contact page</Link>; bugs
            and requests are welcome on{" "}
            <a href="https://github.com/Cliefden/celiador/issues" className="text-brand hover:underline">GitHub</a>.
          </p>

          <p>
            For crawlers: the site publishes a{" "}
            <a href="/sitemap.xml" className="text-brand hover:underline">/sitemap.xml</a> and a{" "}
            <a href="/robots.txt" className="text-brand hover:underline">/robots.txt</a>.
          </p>
        </div>
      </div>
    </Container>
  );
}
