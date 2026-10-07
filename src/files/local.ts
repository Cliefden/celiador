/**
 * Local filesystem helpers for serving a server-run session's workspace to the
 * phone file browser. All access is path-sanitized to stay within the run's
 * workspace root; files are size-capped and binary-guarded.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { FsEntry } from "../sessions/types";

/** Largest file we send as text; larger is returned truncated. */
export const MAX_FILE_BYTES = 1_000_000;

/**
 * Resolve `rel` under `root` and return the absolute path only if it stays inside
 * `root` (defeats `../` escapes and absolute-path injection). Returns null otherwise.
 */
export function resolveInside(root: string, rel: string): string | null {
  const normRoot = path.resolve(root);
  const abs = path.resolve(normRoot, rel ?? "");
  if (abs === normRoot || abs.startsWith(normRoot + path.sep)) return abs;
  return null;
}

/** List a directory (dirs first, then files; `.git` hidden). */
export async function listDir(abs: string): Promise<FsEntry[]> {
  const dirents = await fs.readdir(abs, { withFileTypes: true });
  const entries: FsEntry[] = [];
  for (const d of dirents) {
    if (d.name === ".git") continue;
    if (d.isDirectory()) {
      entries.push({ name: d.name, type: "dir" });
    } else if (d.isFile()) {
      let size: number | undefined;
      try {
        size = (await fs.stat(path.join(abs, d.name))).size;
      } catch {
        size = undefined;
      }
      entries.push({ name: d.name, type: "file", size });
    }
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return entries;
}

export interface ReadResult {
  content: string;
  encoding: "utf8";
  truncated: boolean;
  binary: boolean;
}

/** Read a file as utf8, capped at {@link MAX_FILE_BYTES}; flags binary content. */
export async function readFileCapped(abs: string): Promise<ReadResult> {
  const buf = await fs.readFile(abs);
  if (buf.includes(0)) return { content: "", encoding: "utf8", truncated: false, binary: true };
  const truncated = buf.length > MAX_FILE_BYTES;
  const slice = truncated ? buf.subarray(0, MAX_FILE_BYTES) : buf;
  return { content: slice.toString("utf8"), encoding: "utf8", truncated, binary: false };
}

/** Write a file (creating parent dirs). */
export async function writeFileSafe(abs: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
}
