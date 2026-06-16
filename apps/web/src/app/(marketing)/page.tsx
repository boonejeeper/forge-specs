import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export default function MarketingHome() {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between border-b px-6">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded bg-primary text-primary-foreground">
            <span className="text-xs font-bold">FS</span>
          </div>
          <span className="font-semibold">ForgeSpecs</span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto flex max-w-3xl flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Specs that write, review, and maintain themselves.
        </h1>
        <p className="max-w-xl text-pretty text-muted-foreground">
          ForgeSpecs turns an idea into a Vision, PRD, RFC tree, ADRs, DB design,
          OpenAPI and roadmap — collaborative, versioned, and consumable by
          coding agents.
        </p>
        <div className="flex items-center gap-3">
          <Button asChild>
            <Link href="/login">Get started</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/home">Open app</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
