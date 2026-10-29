import type { Context } from "hono";
import type { AppEnv } from "../auth";

/**
 * The editor's extension control manifest (product.json
 * `extensionsGallery.controlUrl`). VS Code reads it to flag malicious
 * extensions, show deprecation warnings and block installs.
 *
 * We serve the Eclipse Foundation's Open VSX manifest — so the malicious list
 * stays exactly as current as upstream — with Celiador's own entries merged
 * into `deprecated`: extensions that run a second AI layer beside the built-in
 * agent (a warning, the user's call) and extensions built only for Cursor
 * (blocked: they cannot work here). Upstream is cached for six hours; if it is
 * unreachable we serve the last good copy, and before the first good fetch,
 * Celiador's entries alone — the editor treats a missing list as "nothing
 * flagged", which is no worse than having no control URL at all.
 *
 * No auth: the gallery service sends none, and nothing here is per-user.
 */

const UPSTREAM_DEFAULT =
  "https://raw.githubusercontent.com/EclipseFdn/publish-extensions/refs/heads/master/extension-control/extensions.json";
const TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

interface DeprecationInfo {
  disallowInstall?: boolean;
  additionalInfo?: string;
}

type Manifest = { malicious: unknown[]; deprecated: Record<string, unknown>; search: unknown[] } & Record<string, unknown>;

const SECOND_AI_LAYER =
  "Celiador has a Claude agent built in. This extension adds a second AI layer beside it — they can compete for the same keystrokes and suggestions. Keep it only if you want both.";
const CURSOR_ONLY = "Built for Cursor and does not run in Celiador.";

/** Celiador's own entries; they override upstream for the same id. Keys lower-case. */
export const CELIADOR_DEPRECATED: Readonly<Record<string, DeprecationInfo>> = {
  "github.copilot": { additionalInfo: SECOND_AI_LAYER },
  "github.copilot-chat": { additionalInfo: SECOND_AI_LAYER },
  "codeium.codeium": { additionalInfo: SECOND_AI_LAYER },
  "continue.continue": { additionalInfo: SECOND_AI_LAYER },
  "saoudrizwan.claude-dev": { additionalInfo: SECOND_AI_LAYER },
  "rooveterinaryinc.roo-cline": { additionalInfo: SECOND_AI_LAYER },
  "tabnine.tabnine-vscode": { additionalInfo: SECOND_AI_LAYER },
  "supermaven.supermaven": { additionalInfo: SECOND_AI_LAYER },
  "anysphere.cursorpyright": { disallowInstall: true, additionalInfo: CURSOR_ONLY },
  "anysphere.remote-ssh": { disallowInstall: true, additionalInfo: CURSOR_ONLY },
  "anysphere.remote-containers": { disallowInstall: true, additionalInfo: CURSOR_ONLY },
};

let cache: { url: string; at: number; manifest: Manifest } | null = null;

function upstreamUrl(): string {
  return process.env.CELIADOR_EXTENSION_CONTROL_UPSTREAM ?? UPSTREAM_DEFAULT;
}

function validManifest(raw: unknown): raw is Manifest {
  if (!raw || typeof raw !== "object") return false;
  const m = raw as Record<string, unknown>;
  return Array.isArray(m.malicious) && (m.deprecated === undefined || (typeof m.deprecated === "object" && m.deprecated !== null));
}

async function upstream(): Promise<Manifest | undefined> {
  const url = upstreamUrl();
  if (cache && cache.url === url && Date.now() - cache.at < TTL_MS) return cache.manifest;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const raw = (await res.json()) as unknown;
    if (!validManifest(raw)) throw new Error("upstream manifest has an unexpected shape");
    const manifest: Manifest = { ...raw, deprecated: raw.deprecated ?? {}, search: Array.isArray(raw.search) ? raw.search : [] };
    cache = { url, at: Date.now(), manifest };
    return manifest;
  } catch (err) {
    console.error("[extensions] control manifest fetch failed:", err instanceof Error ? err.message : err);
    return cache?.url === url ? cache.manifest : undefined;
  }
}

/** The merged manifest. Exported for tests. */
export async function controlManifest(): Promise<Manifest> {
  const base = (await upstream()) ?? { malicious: [], deprecated: {}, search: [] };
  return { ...base, deprecated: { ...base.deprecated, ...CELIADOR_DEPRECATED } };
}

/** Test hook: forget the cached upstream copy. */
export function resetControlCache(): void {
  cache = null;
}

export async function extensionControl(c: Context<AppEnv>): Promise<Response> {
  return c.json(await controlManifest(), 200, { "cache-control": "public, max-age=3600" });
}
