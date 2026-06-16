"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { segment: "", label: "Document" },
  { segment: "history", label: "History" },
  { segment: "graph", label: "Graph" },
  { segment: "activity", label: "Activity" },
];

/** Deep-linkable sub-view tabs for a spec, rendered as <Link>s. */
export function SpecTabs({ base }: { base: string }) {
  const pathname = usePathname();

  return (
    <nav className="-mb-px mt-4 flex gap-4">
      {TABS.map((tab) => {
        const href = tab.segment ? `${base}/${tab.segment}` : base;
        const active = tab.segment
          ? pathname === href || pathname.startsWith(href + "/")
          : pathname === base;
        return (
          <Link
            key={tab.segment || "document"}
            href={href}
            className={cn(
              "border-b-2 px-1 pb-2 text-sm font-medium transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
