import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow } from "@/components/ui";
import { EmailCapture } from "@/components/EmailCapture";
import { AppleIcon, CheckIcon, DownloadIcon } from "@/components/icons";
import { site } from "@/lib/site";
import { formatReleaseDate, latestHref, latestMacDmgHref, latestMacRelease, latestRelease, shortCommit } from "@/lib/releases";

export const metadata: Metadata = {
  title: "Download",
  description: `Download ${site.name} for macOS — a notarized native app that updates itself.`,
};

export default async function DownloadPage() {
  const [release, linux] = await Promise.all([latestMacRelease(), latestRelease("linux-x64")]);
  // Linux has no in-place updater, so the page is the update path: list every package kind.
  const linuxLinks = linux
    ? [
        { label: ".deb", href: latestHref("linux-x64", "deb"), available: !!linux.assetUrls?.deb },
        { label: ".rpm", href: latestHref("linux-x64", "rpm"), available: !!linux.assetUrls?.rpm },
        { label: ".tar.gz", href: latestHref("linux-x64", "archive"), available: true },
      ].filter((l) => l.available)
    : [];

  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] hero-glow" />
      <Container className="relative py-20 sm:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>{release ? "Early access" : "Private preview"}</Eyebrow>
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Download Celiador for Mac
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-fog">
            {release
              ? "A signed, notarized native app. Install once; it keeps itself up to date."
              : "The macOS app is in private preview. Leave your email and we'll send you the signed build the moment it's ready."}
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
              {release ? `Version ${release.productVersion} · built ${formatReleaseDate(release)}` : `Version ${site.macVersion}`}
              {" · "}
              {site.minMacOS}
            </p>

            <div className="mt-6">
              {release?.dmgUrl ? (
                <a
                  href={latestMacDmgHref}
                  className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3.5 text-sm font-medium text-white shadow-[0_10px_40px_-12px_rgba(124,107,255,0.9)] transition hover:brightness-110"
                >
                  <DownloadIcon className="h-4 w-4" />
                  Download .dmg
                </a>
              ) : (
                <button
                  disabled
                  className="w-full cursor-not-allowed rounded-xl border border-line bg-white/[0.03] px-5 py-3.5 text-sm font-medium text-fog-dim"
                >
                  Download .dmg — coming soon
                </button>
              )}
            </div>

            {release?.dmgSha256 && (
              <dl className="mt-5 grid gap-1 text-left font-mono text-[11px] leading-relaxed text-fog-dim">
                <div className="flex gap-3">
                  <dt className="shrink-0 w-14">build</dt>
                  <dd className="truncate">{shortCommit(release)}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="shrink-0 w-14">sha256</dt>
                  <dd className="break-all">{release.dmgSha256}</dd>
                </div>
              </dl>
            )}

            {release && (
              <p className="mt-4 text-xs text-fog-dim">
                Signed with a Developer ID and notarized by Apple — it opens without any Gatekeeper override.
                {" "}
                <Link href="/releases" className="text-brand hover:underline">
                  All releases
                </Link>
              </p>
            )}

            <div className="mt-6 border-t border-line pt-6">
              <p className="text-sm font-medium text-white">
                {release ? (linux ? "Windows? Get notified" : "Windows or Linux? Get notified") : "Get notified at launch"}
              </p>
              <div className="mt-3">
                <EmailCapture
                  compact
                  subject={release ? (linux ? "Celiador for Windows" : "Celiador for Windows / Linux") : undefined}
                  hint={release ? (linux ? "One email when the Windows build ships." : "Tell us which platform you need; one email when it ships.") : undefined}
                />
              </div>
            </div>
          </div>

          {/* Companion + other platforms */}
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-xl border border-line bg-surface/60 px-4 py-3.5">
              <span className="text-sm text-white">iPhone companion</span>
              {site.testflightUrl ? (
                <a href={site.testflightUrl} className="font-mono text-xs text-brand hover:underline" target="_blank" rel="noreferrer">
                  Join on TestFlight
                </a>
              ) : (
                <span className="font-mono text-xs text-fog-dim">TestFlight soon</span>
              )}
            </div>
            <div className="flex items-center justify-between rounded-xl border border-line bg-surface/60 px-4 py-3.5">
              <span className="text-sm text-white">Windows</span>
              <span className="font-mono text-xs text-fog-dim">On the roadmap</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/60 px-4 py-3.5">
              <span className="text-sm text-white">
                Linux
                {linux && <span className="ml-2 font-mono text-[11px] text-fog-dim">x64 · {linux.productVersion}</span>}
              </span>
              {linuxLinks.length > 0 ? (
                <span className="flex items-center gap-3 font-mono text-xs">
                  {linuxLinks.map((l) => (
                    <a key={l.label} href={l.href} className="text-brand hover:underline">
                      {l.label}
                    </a>
                  ))}
                </span>
              ) : (
                <span className="font-mono text-xs text-fog-dim">On the roadmap</span>
              )}
            </div>
          </div>
        </div>

        {/* What you get */}
        <div className="mx-auto mt-16 max-w-2xl">
          <h3 className="text-center text-sm font-semibold uppercase tracking-wider text-fog-dim">
            What&apos;s in the build
          </h3>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {[
              "Native macOS editor built on VS Code",
              "Claude-powered agent across your whole codebase",
              "Every edit reviewable before it lands",
              "Steer runs from your iPhone",
              "Your extensions, themes & keybindings",
              "Automatic updates",
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
