import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * GitHub fetch for the ingest flow. Uses the Git Trees API to get a full
 * recursive file list in a single call, then the raw content endpoint per file
 * so we avoid pulling in a tar/zip dep. For modestly-sized repos (≲ few
 * thousand files) this is fine in the v1 scope; a future optimization could
 * swap in a tarball download path.
 *
 * No new runtime dependencies: pure fetch + node:fs.
 */

export interface GithubFetchOptions {
  /** "owner/repo". */
  ref: string;
  /** Branch / tag / commit. Empty string → repo default branch. */
  branch?: string;
  /** Personal access token (already decrypted). Optional for public repos. */
  token?: string;
  /** Destination directory; must exist (we don't mkdir). */
  destDir: string;
  /** Hard cap on aggregate bytes downloaded; rejects the fetch when exceeded. */
  maxBytes: number;
}

export interface GithubFetchResult {
  /** The branch ref actually used (resolved when branch was empty). */
  branch: string;
  /** Number of files written. */
  fileCount: number;
}

const GH_API = "https://api.github.com";
const HEADERS_BASE: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "forgespecs-ingest",
};

function authHeaders(token?: string): Record<string, string> {
  return token
    ? { ...HEADERS_BASE, Authorization: `Bearer ${token}` }
    : HEADERS_BASE;
}

async function ghFetch(url: string, token?: string): Promise<Response> {
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `GitHub API ${res.status}: ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
    );
  }
  return res;
}

async function resolveDefaultBranch(ref: string, token?: string): Promise<string> {
  const res = await ghFetch(`${GH_API}/repos/${ref}`, token);
  const json = (await res.json()) as { default_branch?: string };
  if (!json.default_branch) throw new Error("repo has no default branch");
  return json.default_branch;
}

interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  size?: number;
  sha: string;
}

async function listTree(
  ref: string,
  branch: string,
  token: string | undefined,
): Promise<TreeEntry[]> {
  // Look up the branch tip sha first.
  const branchRes = await ghFetch(
    `${GH_API}/repos/${ref}/branches/${encodeURIComponent(branch)}`,
    token,
  );
  const branchJson = (await branchRes.json()) as {
    commit?: { commit?: { tree?: { sha?: string } } };
  };
  const treeSha = branchJson.commit?.commit?.tree?.sha;
  if (!treeSha) throw new Error("could not resolve tree sha for branch");

  const treeRes = await ghFetch(
    `${GH_API}/repos/${ref}/git/trees/${treeSha}?recursive=1`,
    token,
  );
  const treeJson = (await treeRes.json()) as {
    tree: TreeEntry[];
    truncated?: boolean;
  };
  if (treeJson.truncated) {
    // For v1 we surface this clearly and stop; full pagination is future work.
    throw new Error(
      "repo tree exceeds GitHub's single-call limit (truncated). Try a smaller branch or use the local path mode.",
    );
  }
  return (treeJson.tree ?? []).filter((e) => e.type === "blob");
}

async function downloadBlob(
  ref: string,
  branch: string,
  repoRelPath: string,
  token: string | undefined,
): Promise<Buffer> {
  const url = `https://raw.githubusercontent.com/${ref}/${encodeURIComponent(branch)}/${repoRelPath
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")}`;
  const res = await fetch(url, {
    headers: token
      ? { Authorization: `Bearer ${token}`, "User-Agent": "forgespecs-ingest" }
      : { "User-Agent": "forgespecs-ingest" },
  });
  if (!res.ok) {
    throw new Error(`raw fetch ${res.status} for ${repoRelPath}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Fetch a repo at branch into `destDir`. Throws if aggregate bytes exceed
 * `maxBytes`. No new deps — uses fetch + Git Trees + raw content URLs.
 */
export async function fetchGithubRepo(
  opts: GithubFetchOptions,
): Promise<GithubFetchResult> {
  const branch = opts.branch?.trim()
    ? opts.branch.trim()
    : await resolveDefaultBranch(opts.ref, opts.token);
  const entries = await listTree(opts.ref, branch, opts.token);

  let total = 0;
  let count = 0;
  for (const entry of entries) {
    if (entry.size && entry.size > opts.maxBytes - total) {
      throw new Error(
        `aggregate fetch would exceed INGEST_MAX_BYTES (${opts.maxBytes}); stopping`,
      );
    }
    const buf = await downloadBlob(opts.ref, branch, entry.path, opts.token);
    total += buf.length;
    if (total > opts.maxBytes) {
      throw new Error(
        `aggregate fetch exceeded INGEST_MAX_BYTES (${opts.maxBytes})`,
      );
    }
    const abs = path.join(opts.destDir, entry.path);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    // Path traversal guard — every blob path must remain under destDir.
    const realDest = await fs.realpath(opts.destDir);
    const resolved = path.resolve(abs);
    if (!resolved.startsWith(realDest + path.sep) && resolved !== realDest) {
      throw new Error(`refused to write out-of-tree path: ${entry.path}`);
    }
    await fs.writeFile(abs, buf);
    count++;
  }
  return { branch, fileCount: count };
}
