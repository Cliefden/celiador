import type { Metadata } from "next";
import { Container, Eyebrow } from "@/components/ui";
import { EmailCapture } from "@/components/EmailCapture";
import { AppleIcon, CheckIcon } from "@/components/icons";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Download",
  description: `Download ${site.name} for macOS. Join the private preview.`,
};

export default function DownloadPage() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] hero-glow" />
      <Container className="relative py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Private preview</Eyebrow>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Download Celiador for Mac
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-fog">
            The macOS app is in private preview. Drop your email and we&apos;ll send you the signed
            build the moment it&apos;s ready.
          </p>
        </div>

        {/* Download card */}
        <div className="mx-auto mt-12 max-w-xl">
          <div className="ring-brand rounded-2xl border border-line bg-surface p-8 text-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-line bg-brand/10 text-white">
              <AppleIcon className="h-8 w-8" />
            </div>
            <h2 className="mt-5 text-xl font-semibold">Celiador for macOS</h2>
            <p className="mt-1 font-mono text-xs text-fog-dim">
              Version {site.macVersion} · {site.minMacOS}
            </p>

            <div className="mt-6">
              {/* Placeholder: swap this for the real .dmg link on launch. */}
              <button
                disabled
                className="w-full cursor-not-allowed rounded-xl border border-line bg-white/[0.03] px-5 py-3.5 text-sm font-medium text-fog-dim"
              >
                Download .dmg — coming soon
              </button>
            </div>

            <div className="mt-6 border-t border-line pt-6">
              <p className="text-sm font-medium text-white">Get notified at launch</p>
              <div className="mt-3">
                <EmailCapture compact />
              </div>
            </div>
          </div>

          {/* Other platforms */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              { os: "Windows", note: "On the roadmap" },
              { os: "Linux", note: "On the roadmap" },
            ].map((p) => (
              <div
                key={p.os}
                className="flex items-center justify-between rounded-xl border border-line bg-surface/60 px-4 py-3.5"
              >
                <span className="text-sm text-white">{p.os}</span>
                <span className="font-mono text-xs text-fog-dim">{p.note}</span>
              </div>
            ))}
          </div>
        </div>

        {/* What you get */}
        <div className="mx-auto mt-16 max-w-2xl">
          <h3 className="text-center text-sm font-semibold uppercase tracking-wider text-fog-dim">
            What&apos;s in the preview
          </h3>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              "Native macOS editor built on VS Code",
              "AI chat across your whole codebase",
              "Agent edits with reviewable diffs",
              "Your extensions, themes & keybindings",
              "Bring your own model key",
              "Automatic preview updates",
            ].map((t) => (
              <li key={t} className="flex items-start gap-3 rounded-xl border border-line bg-surface/40 px-4 py-3 text-sm text-fog">
                <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
