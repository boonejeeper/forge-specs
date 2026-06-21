import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { listGuidePages, getGuidePage } from "@/lib/guide/load";
import { renderMarkdown } from "@/lib/guide/render";
import { GuideNav } from "../_nav";

export const dynamic = "force-static";

export function generateStaticParams() {
  return listGuidePages()
    .filter((p) => p.slug !== "")
    .map((p) => ({ slug: p.slug }));
}

export default async function GuideSectionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = getGuidePage(slug);
  if (!page) notFound();
  const pages = listGuidePages().filter((p) => p.slug !== "");

  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between border-b px-6">
        <div className="flex items-center gap-2">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded bg-primary text-primary-foreground">
              <span className="text-xs font-bold">FS</span>
            </div>
            <span className="font-semibold">ForgeSpecs</span>
          </Link>
          <span className="ml-2 text-sm text-muted-foreground">
            / <Link href="/guide" className="hover:underline">Guide</Link> /{" "}
            {page.title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-1 gap-12 px-6 py-10">
        <GuideNav pages={pages} active={slug} />
        <article className="min-w-0 flex-1">
          <div className="prose prose-sm dark:prose-invert">
            {renderMarkdown(page.body)}
          </div>
        </article>
      </div>
    </main>
  );
}
