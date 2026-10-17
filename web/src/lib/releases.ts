// Published editor builds, read from the daemon's release listing — the same
// manifest the editor's built-in updater polls, so the site can never advertise
// a build the updater doesn't know. Written by the editor's release script
// (celiador-editor/build/celiador/release-macos.sh --publish).
//
// Server-only: pages fetch at render time with a short revalidation window, and
// fall back to "no release" when the API is unreachable so the site still builds
// and renders offline (the download page then shows the notify form instead).

export type Release = {
  platform: string;
  quality: string;
  /** The build's commit hash (what the updater compares). */
  version: string;
  /** Human version, e.g. "1.138.0". */
  productVersion: string;
  /** Build time, ms since epoch. */
  timestamp: number;
  archive: string;
  archiveSha256: string;
  dmg?: string;
  dmgSha256?: string;
  notes?: string;
  archiveUrl: string;
  dmgUrl?: string;
};

const API = (process.env.CELIADOR_RELEASES_API ?? "https://celiador.ai/api/releases").replace(/\/+$/, "");

/** Stable link that always resolves to the newest macOS DMG (302 → the file). */
export const latestMacDmgHref = `${API}/latest/darwin-arm64/stable/dmg`;

/** Seconds the site keeps a fetched listing before asking the daemon again. */
const REVALIDATE_SECONDS = 300;

async function getJson<T>(path: string): Promise<T | undefined> {
  try {
    const res = await fetch(`${API}${path}`, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

/** Every published build, newest first; empty when none or unreachable. */
export async function listReleases(): Promise<Release[]> {
  const data = await getJson<{ releases?: Release[] }>("");
  return Array.isArray(data?.releases) ? data!.releases : [];
}

/** The newest macOS (Apple Silicon) build, or undefined before the first release. */
export async function latestMacRelease(): Promise<Release | undefined> {
  return getJson<Release>("/latest/darwin-arm64/stable");
}

export function shortCommit(release: Pick<Release, "version">): string {
  return release.version.slice(0, 7);
}

export function formatReleaseDate(release: Pick<Release, "timestamp">): string {
  return new Date(release.timestamp).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
