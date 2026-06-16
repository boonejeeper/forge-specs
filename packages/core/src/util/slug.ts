/**
 * Slugify a free-text title into a URL-safe segment. Shared by Workspace,
 * Project, and Document creation so slugs are generated consistently across the
 * web app and the seed script.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64) || "untitled";
}

/**
 * Ensure a slug is unique within a set of taken slugs by appending `-2`, `-3`,
 * … as needed. `taken` should be the set of existing sibling slugs.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
