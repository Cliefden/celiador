import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config";

/**
 * Where release artifacts + `manifest.json` live. The editor's release script
 * (`celiador-editor/build/celiador/release-macos.sh --publish`) rsyncs here.
 */
export const RELEASES_DIR = process.env.CELIADOR_RELEASES_DIR ?? path.join(ROOT, "releases");

/** Public origin the download URLs are built on (what Caddy fronts). */
export const PUBLIC_URL = (process.env.CELIADOR_PUBLIC_URL ?? "https://celiador.ai").replace(/\/+$/, "");

/** One published build. Written by the editor's release script, read by the feed. */
export interface ReleaseEntry {
  /** Asset id the editor's update service asks for, e.g. `darwin-arm64`. */
  platform: string;
  /** product.json `quality`, e.g. `stable`. */
  quality: string;
  /** The build's commit hash (product.json `commit`) — what the updater compares. */
  version: string;
  /** Human version, e.g. `1.138.0`. */
  productVersion: string;
  /** Build time, ms since epoch. Newest wins. */
  timestamp: number;
  /** Zip of the stapled .app — the only payload Squirrel.Mac can apply. */
  archive: string;
  archiveSha256: string;
  /** What a person downloads from the site. */
  dmg?: string;
  dmgSha256?: string;
  /** Short release notes (markdown). */
  notes?: string;
}

/** A plain file name: no path separators, no leading dot, so `..` can't be smuggled in. */
export const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
export const COMMIT = /^[0-9a-f]{7,40}$/;
export const ID = /^[a-z0-9][a-z0-9-]{0,40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

function validEntry(raw: unknown): raw is ReleaseEntry {
  if (!raw || typeof raw !== "object") return false;
  const e = raw as Record<string, unknown>;
  const str = (v: unknown, re: RegExp): v is string => typeof v === "string" && re.test(v);
  return (
    str(e.platform, ID) &&
    str(e.quality, ID) &&
    str(e.version, COMMIT) &&
    typeof e.productVersion === "string" && e.productVersion.length > 0 && e.productVersion.length <= 40 &&
    typeof e.timestamp === "number" && Number.isFinite(e.timestamp) && e.timestamp > 0 &&
    str(e.archive, FILE_NAME) &&
    str(e.archiveSha256, SHA256) &&
    (e.dmg === undefined || str(e.dmg, FILE_NAME)) &&
    (e.dmgSha256 === undefined || str(e.dmgSha256, SHA256)) &&
    (e.notes === undefined || (typeof e.notes === "string" && e.notes.length <= 20_000))
  );
}

let cache: { key: string; entries: ReleaseEntry[] } | null = null;

/**
 * Every valid manifest entry, newest first. Re-read whenever `manifest.json`
 * changes on disk (the release script uploads artifacts first, manifest last, so
 * an entry never points at a file that isn't there yet). Invalid entries are
 * skipped, not fatal: one bad line must not take the feed down.
 */
export function readManifest(): ReleaseEntry[] {
  const file = path.join(RELEASES_DIR, "manifest.json");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    cache = null;
    return [];
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  if (cache?.key === key) return cache.entries;
  let entries: ReleaseEntry[] = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { releases?: unknown };
    entries = (Array.isArray(parsed.releases) ? parsed.releases : []).filter(validEntry);
  } catch (err) {
    console.error("[releases] manifest.json unreadable:", err instanceof Error ? err.message : err);
  }
  entries.sort((a, b) => b.timestamp - a.timestamp);
  cache = { key, entries };
  return entries;
}

export function latestRelease(platform: string, quality: string): ReleaseEntry | undefined {
  return readManifest().find((e) => e.platform === platform && e.quality === quality);
}

export function isKnownRelease(platform: string, quality: string, version: string): boolean {
  return readManifest().some((e) => e.platform === platform && e.quality === quality && e.version === version);
}

/** Only files a manifest entry names are served — never anything else in the dir. */
export function isPublishedFile(file: string): boolean {
  return readManifest().some((e) => e.archive === file || e.dmg === file);
}

export function fileUrl(file: string): string {
  return `${PUBLIC_URL}/api/releases/${encodeURIComponent(file)}`;
}

/** An entry as the site shows it: with absolute download URLs. */
export function publicEntry(e: ReleaseEntry): ReleaseEntry & { archiveUrl: string; dmgUrl?: string } {
  return { ...e, archiveUrl: fileUrl(e.archive), dmgUrl: e.dmg ? fileUrl(e.dmg) : undefined };
}
