import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Allowlist + symlink-escape guard for the LOCAL ingest source.
 *
 * The user supplies an absolute path; this validates it against
 * INGEST_LOCAL_ALLOWED_ROOTS (CSV of absolute roots) AFTER realpath resolution,
 * so a symlink pointing outside the allowlist is rejected. An empty allowlist
 * disables local mode entirely (the form surface hides it).
 */

export class IngestPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestPathError";
  }
}

export function parseAllowedRoots(csv: string | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && path.isAbsolute(s))
    .map((s) => path.resolve(s));
}

/**
 * Resolve the user-supplied path to a real path and assert it lives under one
 * of the allowed roots. Throws IngestPathError on any violation. Returns the
 * resolved real path (use this for the actual walk).
 */
export function resolveAllowedLocalPath(input: {
  rawPath: string;
  allowedRoots: string[];
}): string {
  const raw = input.rawPath.trim();
  if (!raw) throw new IngestPathError("Path is required.");
  if (!path.isAbsolute(raw)) {
    throw new IngestPathError("Path must be absolute.");
  }
  if (input.allowedRoots.length === 0) {
    throw new IngestPathError("Local ingest is disabled on this server.");
  }

  let real: string;
  try {
    real = realpathSync(raw);
  } catch {
    throw new IngestPathError(`Path does not exist: ${raw}`);
  }

  const ok = input.allowedRoots.some((root) => {
    const r = realpathSafe(root);
    if (!r) return false;
    if (real === r) return true;
    return real.startsWith(r + path.sep);
  });
  if (!ok) {
    throw new IngestPathError(
      `Path is not under any allowed root (INGEST_LOCAL_ALLOWED_ROOTS).`,
    );
  }
  return real;
}

function realpathSafe(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}
