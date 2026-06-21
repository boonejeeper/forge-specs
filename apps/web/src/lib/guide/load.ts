import "server-only";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseFrontmatter } from "@forgespecs/ai";

/**
 * Static loader for the runbook markdown that lives under `docs/guide/*.md`.
 *
 * Read ONCE at module-import time and cached on the module so route handlers
 * pay zero IO per request. The standalone Docker build needs the docs/ dir
 * traced — see `outputFileTracingIncludes` in `apps/web/next.config.ts`.
 */

export interface GuidePage {
  slug: string;
  title: string;
  order: number;
  body: string;
  description?: string;
}

const DOCS_DIR = path.resolve(process.cwd(), "../../docs/guide");

function loadAll(): GuidePage[] {
  let entries: string[];
  try {
    entries = readdirSync(DOCS_DIR);
  } catch {
    // Missing docs dir in some test contexts — fail soft.
    return [];
  }
  const out: GuidePage[] = [];
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const slug = name === "index.md" ? "" : name.replace(/\.md$/, "");
    const raw = readFileSync(path.join(DOCS_DIR, name), "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    out.push({
      slug,
      title: frontmatter.title ?? (slug || "ForgeSpecs guide"),
      order: Number.parseInt(frontmatter.order ?? "999", 10),
      body,
      description: frontmatter.description,
    });
  }
  out.sort((a, b) => a.order - b.order);
  return out;
}

let cache: GuidePage[] | null = null;

export function listGuidePages(): GuidePage[] {
  if (!cache) cache = loadAll();
  return cache;
}

export function getGuidePage(slug: string): GuidePage | null {
  return listGuidePages().find((p) => p.slug === slug) ?? null;
}
