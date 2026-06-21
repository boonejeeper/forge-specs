import Link from "next/link";

/**
 * Shared guide sidebar nav. Lives in an underscore-prefixed file so Next's
 * file-based router skips it (only page.tsx / layout.tsx files become routes).
 */
export function GuideNav({
  pages,
  active,
}: {
  pages: { slug: string; title: string }[];
  active: string;
}) {
  return (
    <nav className="hidden w-56 shrink-0 md:block">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Sections
      </p>
      <ul className="space-y-1 text-sm">
        <li>
          <Link
            href="/guide"
            className={
              active === ""
                ? "block rounded px-2 py-1 font-medium text-foreground"
                : "block rounded px-2 py-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            }
          >
            Overview
          </Link>
        </li>
        {pages.map((p) => (
          <li key={p.slug}>
            <Link
              href={`/guide/${p.slug}`}
              className={
                active === p.slug
                  ? "block rounded px-2 py-1 font-medium text-foreground"
                  : "block rounded px-2 py-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              }
            >
              {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
