import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { classifyFile, type RepoFileKind } from "./classify";

/**
 * Walk a snapshot directory and produce a manifest of repo files with sha-256s
 * and kind classifications. Honors a hardcoded denylist of well-known build
 * artifacts + a max byte size per file. Returns POSIX-relative paths so the
 * shape matches the GitHub fetch path (and is portable across the LOCAL/GITHUB
 * fetch modes).
 *
 * NB: no `.gitignore` parsing — we rely on the denylist for the common case so
 * the walker stays dependency-free. The denylist + an optional realpath escape
 * check at the top is enough for the v1 ingest scope.
 */

export interface WalkedFile {
  /** POSIX repo-relative path (forward slashes). */
  path: string;
  sha: string;
  bytes: number;
  kind: RepoFileKind;
}

export interface WalkOptions {
  /** Files above this byte size are recorded as BINARY_SKIPPED. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 1_048_576; // 1 MiB

const DENYLIST_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "dist",
  "build",
  "out",
  "coverage",
  ".venv",
  "__pycache__",
  ".idea",
  ".vscode",
  "target", // rust
  ".terraform",
]);

const DENYLIST_FILES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
]);

export async function walkRepo(
  rootDir: string,
  options: WalkOptions = {},
): Promise<WalkedFile[]> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const out: WalkedFile[] = [];
  await walkDir(rootDir, "", out, maxBytes);
  // Sorted output → deterministic per-stage progress and synthesis prompts.
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

async function walkDir(
  rootDir: string,
  rel: string,
  out: WalkedFile[],
  maxBytes: number,
): Promise<void> {
  const dirAbs = path.join(rootDir, rel);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".") && ent.name === ".git") continue;
    if (ent.isSymbolicLink()) continue;
    const childRel = rel ? `${rel}/${ent.name}` : ent.name;
    const childAbs = path.join(dirAbs, ent.name);

    if (ent.isDirectory()) {
      if (DENYLIST_DIRS.has(ent.name)) continue;
      await walkDir(rootDir, childRel, out, maxBytes);
      continue;
    }
    if (!ent.isFile()) continue;
    if (DENYLIST_FILES.has(ent.name)) continue;

    let st: import("node:fs").Stats;
    try {
      st = await fs.stat(childAbs);
    } catch {
      continue;
    }
    if (st.size > maxBytes) {
      out.push({
        path: childRel,
        sha: "size-skipped",
        bytes: st.size,
        kind: "BINARY_SKIPPED",
      });
      continue;
    }

    let buf: Buffer;
    try {
      buf = await fs.readFile(childAbs);
    } catch {
      continue;
    }
    const sha = createHash("sha256").update(buf).digest("hex");
    const kind = classifyFile(childRel);
    out.push({ path: childRel, sha, bytes: st.size, kind });
  }
}

/** Read a single file from the snapshot as utf-8 (after the walk classified it). */
export async function readSnapshotFile(
  rootDir: string,
  repoRelPath: string,
): Promise<string> {
  const abs = path.join(rootDir, repoRelPath);
  const real = await fs.realpath(abs);
  // Guard against archive entries that escape the snapshot root.
  const rootReal = await fs.realpath(rootDir);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw new Error(`refused to read out-of-tree path: ${repoRelPath}`);
  }
  return fs.readFile(real, "utf8");
}
