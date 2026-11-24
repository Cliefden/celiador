/**
 * Local filesystem helpers for serving a server-run session's workspace to the
 * phone file browser. All access is confined to the run's workspace root —
 * lexically (no `../`, no absolute paths) AND on the real filesystem: the
 * workspace is written by a sandboxed agent, so a symlink in it may point
 * anywhere on the host (the daemon's .env, say). Every path is resolved with
 * realpath and must land inside the root's real path; a write never follows a
 * symlink in its last component (O_NOFOLLOW). Files are size-capped and
 * binary-guarded; only regular files are read or written.
 */
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FsEntry } from "../sessions/types";

/** Largest file we send as text; larger is returned truncated. */
export const MAX_FILE_BYTES = 1_000_000;

/** A path that resolves (through a symlink) outside the workspace, or isn't a plain file/dir. */
export class OutsideRootError extends Error {
  constructor(message = "bad path") {
    super(message);
  }
}

/**
 * Whether `rel` (relative to a workspace root) names `.git` or anything under
 * one, at any depth. The workspace's git metadata is the daemon's, not the
 * phone's: host git runs in this tree, so a `.git` file or config written here
 * (a `gitdir:` redirect, `core.fsmonitor`, a hook) would run commands on the
 * host. Case-insensitive, for case-insensitive filesystems.
 */
function touchesGitDir(rel: string): boolean {
  return rel.split(/[\\/]/).some((segment) => segment.toLowerCase() === ".git");
}

/**
 * Resolve `rel` under `root` and return the absolute path only if it stays inside
 * `root` (defeats `../` escapes and absolute-path injection) and stays out of the
 * workspace's `.git`. Returns null otherwise. Lexical only — the I/O helpers
 * below also confine the *real* path.
 */
export function resolveInside(root: string, rel: string): string | null {
  const normRoot = path.resolve(root);
  const abs = path.resolve(normRoot, rel ?? "");
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) return null;
  if (touchesGitDir(path.relative(normRoot, abs))) return null;
  return abs;
}

function within(realRoot: string, real: string): boolean {
  return (real === realRoot || real.startsWith(realRoot + path.sep)) && !touchesGitDir(path.relative(realRoot, real));
}

/**
 * The real path of `abs` (symlinks resolved), only if it is inside `root`'s real
 * path and not in its `.git` (a symlink like `g -> .git` is refused too); throws
 * OutsideRootError otherwise, and ENOENT when it doesn't exist.
 */
export async function realInside(root: string, abs: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const real = await fs.realpath(abs);
  if (!within(realRoot, real)) throw new OutsideRootError();
  return real;
}

/**
 * List a directory (dirs first, then files; `.git` hidden). The directory
 * itself must resolve inside `root`, and a symlink entry is listed as what it
 * points to only when that target is inside too — anything pointing out (or
 * dangling) is left out.
 */
export async function listDir(abs: string, root: string): Promise<FsEntry[]> {
  const dir = await realInside(root, abs);
  const realRoot = await fs.realpath(root);
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const entries: FsEntry[] = [];
  for (const d of dirents) {
    if (d.name === ".git") continue;
    let isDir = d.isDirectory();
    let isFile = d.isFile();
    if (d.isSymbolicLink()) {
      try {
        const target = await fs.realpath(path.join(dir, d.name));
        if (!within(realRoot, target)) continue;
        const st = await fs.stat(target);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
    }
    if (isDir) {
      entries.push({ name: d.name, type: "dir" });
    } else if (isFile) {
      let size: number | undefined;
      try {
        size = (await fs.stat(path.join(dir, d.name))).size;
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

/**
 * Read a file as utf8, capped at {@link MAX_FILE_BYTES}; flags binary content.
 * The file's real path must be inside `root` and be a regular file (a FIFO or
 * device would block or leak).
 */
export async function readFileCapped(abs: string, root: string): Promise<ReadResult> {
  const file = await realInside(root, abs);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw new OutsideRootError("not a file");
    const want = Math.min(st.size, MAX_FILE_BYTES + 1);
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const { bytesRead } = await handle.read(buf, got, want - got, got);
      if (bytesRead === 0) break;
      got += bytesRead;
    }
    const data = buf.subarray(0, got);
    if (data.includes(0)) return { content: "", encoding: "utf8", truncated: false, binary: true };
    const truncated = data.length > MAX_FILE_BYTES;
    const slice = truncated ? data.subarray(0, MAX_FILE_BYTES) : data;
    return { content: slice.toString("utf8"), encoding: "utf8", truncated, binary: false };
  } finally {
    await handle.close();
  }
}

/**
 * Write a file (creating parent dirs). The deepest existing parent must resolve
 * inside `root` (so `mkdir -p` never walks through a symlink out of the
 * workspace), the parent is checked again after it's created, and the file is
 * opened with O_NOFOLLOW so a symlink in the last component is refused (ELOOP),
 * never written through.
 */
export async function writeFileSafe(abs: string, content: string, root: string): Promise<void> {
  const parent = path.dirname(abs);
  let existing = parent;
  for (;;) {
    try {
      await fs.lstat(existing);
      break;
    } catch {
      const up = path.dirname(existing);
      if (up === existing) throw new OutsideRootError();
      existing = up;
    }
  }
  await realInside(root, existing);
  await fs.mkdir(parent, { recursive: true });
  const realParent = await realInside(root, parent);
  if (touchesGitDir(path.basename(abs))) throw new OutsideRootError();
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(path.join(realParent, path.basename(abs)), constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o644);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ELOOP") throw new OutsideRootError("is a symlink");
    throw err;
  }
  try {
    if (!(await handle.stat()).isFile()) throw new OutsideRootError("not a file");
    await handle.truncate(0);
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}
