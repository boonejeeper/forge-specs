/**
 * Mention parsing for comment bodies (pure logic).
 *
 * Comment bodies are stored as plain text (`Comment.body`). The comment composer
 * encodes a mention as a markdown-link-like token so the body stays a single
 * string yet carries a resolvable target:
 *
 *   @[Alice](user:clx123)      → a user mention (notifies that user)
 *   @[agent](agent:architect)  → an agent mention (isAgent; triggers AI in M6/M7)
 *
 * Parsing is pure and unit-tested here; the comment action turns each parsed
 * mention into a `Mention` row and, for users, a `Notification`. Agent mentions
 * set `isAgent` so M6/M7's run-trigger can pick them up via the same rows — no
 * new path needed.
 */

export type ParsedMention =
  | { kind: "user"; userId: string; label: string }
  | { kind: "agent"; agentName: string; label: string };

const MENTION_RE = /@\[([^\]]+)\]\((user|agent):([^)]+)\)/g;

/**
 * Extract all mentions from a comment body. De-duplicates by target so a user
 * mentioned twice gets a single Mention/Notification.
 */
export function parseMentions(body: string): ParsedMention[] {
  const out: ParsedMention[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) {
    const label = m[1]!;
    const type = m[2]!;
    const target = m[3]!.trim();
    if (!target) continue;
    const key = `${type}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (type === "user") {
      out.push({ kind: "user", userId: target, label });
    } else {
      out.push({ kind: "agent", agentName: target, label });
    }
  }
  return out;
}

/** Render a mention token (used by the composer / for tests). */
export function mentionToken(
  kind: "user" | "agent",
  target: string,
  label: string,
): string {
  return `@[${label}](${kind}:${target})`;
}

/**
 * Replace mention tokens with their human label for plain-text rendering
 * fallbacks (e.g. notification body previews). "@[Alice](user:x)" → "@Alice".
 */
export function renderMentionsPlain(body: string): string {
  return body.replace(MENTION_RE, (_full, label: string) => `@${label}`);
}
