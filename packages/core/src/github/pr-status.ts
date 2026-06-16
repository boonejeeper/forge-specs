/**
 * Pure GitHub pull-request event interpretation (M11) — NO I/O, NO crypto.
 *
 * Maps a GitHub `pull_request` webhook payload to our PullRequestState + merged
 * flag, and parses PR URLs into (owner, repo, number). Kept pure so it is
 * trivially unit-testable; the route handles signature verification + DB writes.
 */

export type PullRequestState = "OPEN" | "CLOSED" | "MERGED" | "DRAFT";

export interface ParsedPrRef {
  owner: string;
  repo: string;
  number: number;
}

/** Minimal shape of the GitHub `pull_request` webhook payload we read. */
export interface GithubPullRequestPayload {
  action?: string;
  number?: number;
  pull_request?: {
    number?: number;
    html_url?: string;
    title?: string;
    state?: string; // "open" | "closed"
    draft?: boolean;
    merged?: boolean;
    merged_at?: string | null;
  };
  repository?: {
    name?: string;
    owner?: { login?: string };
    full_name?: string; // "owner/repo"
  };
}

export interface InterpretedPrEvent {
  ref: ParsedPrRef;
  state: PullRequestState;
  merged: boolean;
  title: string | undefined;
  url: string | undefined;
}

/** Derive PullRequestState from the PR object. Merged wins over closed. */
export function prStateFromPayload(
  pr: NonNullable<GithubPullRequestPayload["pull_request"]>,
): { state: PullRequestState; merged: boolean } {
  const merged = pr.merged === true || typeof pr.merged_at === "string";
  if (merged) return { state: "MERGED", merged: true };
  if (pr.draft === true) return { state: "DRAFT", merged: false };
  if (pr.state === "closed") return { state: "CLOSED", merged: false };
  return { state: "OPEN", merged: false };
}

/** Parse "https://github.com/owner/repo/pull/123" → ref. Returns null if invalid. */
export function parsePrUrl(url: string): ParsedPrRef | null {
  const m = url
    .trim()
    .match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/i);
  if (!m) return null;
  const number = Number.parseInt(m[3]!, 10);
  if (!Number.isFinite(number) || number <= 0) return null;
  return { owner: m[1]!, repo: m[2]!, number };
}

/**
 * Interpret a `pull_request` webhook payload into an actionable event, or null
 * if the payload is missing the fields we need (so the route can 200-ignore it).
 */
export function interpretPullRequestEvent(
  payload: GithubPullRequestPayload,
): InterpretedPrEvent | null {
  const pr = payload.pull_request;
  if (!pr) return null;

  const number = pr.number ?? payload.number;
  if (typeof number !== "number") return null;

  let owner = payload.repository?.owner?.login;
  let repo = payload.repository?.name;
  if ((!owner || !repo) && payload.repository?.full_name) {
    const [o, r] = payload.repository.full_name.split("/");
    owner = owner ?? o;
    repo = repo ?? r;
  }
  if (!owner || !repo) return null;

  const { state, merged } = prStateFromPayload(pr);
  return {
    ref: { owner, repo, number },
    state,
    merged,
    title: pr.title,
    url: pr.html_url,
  };
}
