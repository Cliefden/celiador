import type { Metadata } from "next";
import Link from "next/link";
import { Container, Eyebrow } from "@/components/ui";
import { DownloadIcon } from "@/components/icons";
import { formatReleaseDate, listReleases, shortCommit } from "@/lib/releases";

export const metadata: Metadata = {
  title: "Releases",
  description: "Every published Celiador build for macOS, with checksums.",
};

export default async function ReleasesPage() {
  const releases = await listReleases();

  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[300px] hero-glow" />
      <Container className="relative py-20 sm:py-24">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <Eyebrow>Releases</Eyebrow>
            <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              Every build we shipped
            </h1>
            <p className="mt-4 text-lg text-fog">
              One entry per published macOS build, straight from the update feed the app itself
              uses. Installed apps update to the newest one on their own.{" "}
              <Link href="/changelog" className="text-brand hover:underline">
                Read the changelog
              </Link>{" "}
              for the story behind them.
            </p>
          </div>

          {releases.length === 0 ? (
            <p className="mt-14 rounded-2xl border border-line bg-surface/60 px-6 py-8 text-center text-sm text-fog">
              No builds published yet. The first one lands on the{" "}
              <Link href="/download" className="text-brand hover:underline">
                download page
              </Link>{" "}
              the moment it ships.
            </p>
          ) : (
            <div className="mt-14 space-y-10">
              {releases.map((r, i) => (
                <div key={`${r.platform}-${r.version}`} className="relative border-l border-line pl-8">
                  <span className="absolute -left-2 top-1.5 h-4 w-4 rounded-full border-2 border-brand bg-ink" />
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-xl font-semibold tracking-tight">v{r.productVersion}</h2>
                    {i === 0 && (
                      <span className="rounded-full border border-line bg-brand/10 px-2.5 py-0.5 text-xs text-brand">
                        Latest
                      </span>
                    )}
                    <span className="font-mono text-xs text-fog-dim">
                      {formatReleaseDate(r)} · {shortCommit(r)} · {r.platform}
                    </span>
                  </div>
                  {r.notes && (
                    <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-fog">{r.notes}</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {r.dmgUrl && (
                      <a
                        href={r.dmgUrl}
                        className="inline-flex items-center gap-2 rounded-lg border border-line bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/[0.07]"
                      >
                        <DownloadIcon className="h-3.5 w-3.5" />
                        {r.dmg}
                      </a>
                    )}
                    <a
                      href={r.archiveUrl}
                      className="inline-flex items-center gap-2 rounded-lg border border-line bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-fog transition hover:bg-white/[0.07]"
                    >
                      <DownloadIcon className="h-3.5 w-3.5" />
                      {r.archive}
                    </a>
                  </div>
                  <dl className="mt-3 grid gap-1 font-mono text-[11px] leading-relaxed text-fog-dim">
                    {r.dmgSha256 && (
                      <div className="flex gap-3">
                        <dt className="w-16 shrink-0">dmg</dt>
                        <dd className="break-all">{r.dmgSha256}</dd>
                      </div>
                    )}
                    <div className="flex gap-3">
                      <dt className="w-16 shrink-0">zip</dt>
                      <dd className="break-all">{r.archiveSha256}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}
