import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../auth";
import {
  COMMIT,
  FILE_NAME,
  ID,
  PUBLIC_URL,
  RELEASES_DIR,
  fileUrl,
  isKnownRelease,
  isPublishedFile,
  latestRelease,
  publicEntry,
  readManifest,
  releaseFile,
} from "./manifest";

const NO_CACHE = { "cache-control": "no-cache" };

/**
 * Where a Linux editor sends the user when it notices a newer build: there is no
 * in-place updater on Linux (`updateService.linux` opens `url` in the browser), so
 * point at the download page, where they pick .deb/.rpm/.tar.gz, rather than at a
 * bare archive. macOS (Squirrel) and Windows (inno updater) download `url` itself.
 */
const DOWNLOAD_PAGE_URL = (process.env.CELIADOR_DOWNLOAD_URL ?? `${PUBLIC_URL}/download`).replace(/\/+$/, "");

/**
 * Update feed for the editor's built-in updater (Electron autoUpdater /
 * Squirrel.Mac). The editor asks `GET /api/update/<platform>/<quality>/<commit>`
 * — product.json `updateUrl` plus the path `abstractUpdateService` builds — and
 * expects either 204 (nothing newer) or the newest build's descriptor.
 *
 * Only commits the manifest knows are ever offered an update: a local dev build
 * (unknown commit) gets 204, so a developer is never "updated" to an older
 * published release. Which means the manifest keeps every entry forever — the
 * release script appends, it never prunes.
 *
 * No auth: the updater sends no bearer token, and nothing here is per-user.
 */
export function updateFeed(c: Context<AppEnv>): Response {
  const platform = c.req.param("platform") ?? "";
  const quality = c.req.param("quality") ?? "";
  const commit = c.req.param("commit") ?? "";
  if (!ID.test(platform) || !ID.test(quality) || !COMMIT.test(commit)) {
    return c.json({ error: "platform, quality and commit are required" }, 400);
  }
  const latest = latestRelease(platform, quality);
  if (!latest || latest.version === commit || !isKnownRelease(platform, quality, commit)) {
    return c.body(null, 204, NO_CACHE);
  }
  // The shape VS Code's update server returns (IUpdate): `url` is what Squirrel
  // downloads, `version` is the commit the editor records as pending. Squirrel.Mac
  // itself only reads `url`, `name`, `notes` and `pub_date`, and the editor fills
  // its downloaded-update record from those (`notes` → version, `name` →
  // productVersion, `pub_date` → timestamp), so the commit goes in `notes` too.
  return c.json(
    {
      url: latest.platform.startsWith("linux") ? DOWNLOAD_PAGE_URL : fileUrl(latest.archive),
      name: latest.productVersion,
      notes: latest.version,
      pub_date: new Date(latest.timestamp).toISOString(),
      version: latest.version,
      productVersion: latest.productVersion,
      timestamp: latest.timestamp,
      sha256hash: latest.archiveSha256,
    },
    200,
    NO_CACHE
  );
}

const CONTENT_TYPES: Record<string, string> = {
  ".zip": "application/zip",
  ".dmg": "application/x-apple-diskimage",
  ".gz": "application/gzip",
  ".deb": "application/vnd.debian.binary-package",
  ".rpm": "application/x-rpm",
  ".exe": "application/vnd.microsoft.portable-executable",
};

/**
 * Public release listing + artifact downloads, mounted at /api/releases. The
 * marketing site's download button and /releases page read these; the update
 * feed's `url` points at the archive route.
 */
export function releaseRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Everything published, newest first, with absolute download URLs.
  app.get("/", (c) => c.json({ releases: readManifest().map(publicEntry) }, 200, NO_CACHE));

  // The newest build for a platform/quality — what the download button links.
  app.get("/latest/:platform/:quality", (c) => {
    const platform = c.req.param("platform");
    const quality = c.req.param("quality");
    if (!ID.test(platform) || !ID.test(quality)) {
      return c.json({ error: "platform and quality are required" }, 400);
    }
    const latest = latestRelease(platform, quality);
    return latest ? c.json(publicEntry(latest), 200, NO_CACHE) : c.json({ error: "No release" }, 404);
  });

  // Stable links that always resolve to the newest artifact of a kind (302 → the
  // file): `archive`, `dmg`, or any `assets` key the entry carries (deb, rpm, …).
  app.get("/latest/:platform/:quality/:kind", (c) => {
    const platform = c.req.param("platform");
    const quality = c.req.param("quality");
    const kind = c.req.param("kind");
    if (!ID.test(platform) || !ID.test(quality) || !ID.test(kind)) {
      return c.json({ error: "platform, quality and kind are required" }, 400);
    }
    const latest = latestRelease(platform, quality);
    const file = latest ? releaseFile(latest, kind) : undefined;
    if (!file) return c.json({ error: "No release" }, 404);
    return c.redirect(fileUrl(file), 302);
  });

  // The artifact itself. Only names a manifest entry lists are served, so the
  // releases dir can hold manifest.json, scratch files, etc. without exposing them.
  app.on(["GET", "HEAD"], "/:file", (c) => {
    const file = c.req.param("file");
    if (!FILE_NAME.test(file) || !isPublishedFile(file)) {
      return c.json({ error: "Not found" }, 404);
    }
    const full = path.join(RELEASES_DIR, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
    if (!stat.isFile()) return c.json({ error: "Not found" }, 404);
    const headers = {
      "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
      "content-length": String(stat.size),
      "content-disposition": `attachment; filename="${file}"`,
      // Artifact names carry the version, so a file never changes once published.
      "cache-control": "public, max-age=31536000, immutable",
    };
    if (c.req.method === "HEAD") return c.body(null, 200, headers);
    return c.body(Readable.toWeb(fs.createReadStream(full)) as ReadableStream, 200, headers);
  });

  return app;
}
