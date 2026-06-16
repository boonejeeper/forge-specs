import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  toBundleExport,
  bundleToMarkdown,
  bundleToJson,
  bundleToYaml,
  serializeBundle,
  serializeDocument,
  resolveFormat,
  type BundleMeta,
} from "./bundle";
import { type ExportDocument } from "./serialize";

const meta: BundleMeta = {
  title: "Agent: backend",
  description: "Assigned work for agent backend",
  generatedAt: "2026-06-15T00:00:00.000Z",
};

function doc(id: string, title: string, type = "RFC"): ExportDocument {
  return {
    id,
    slug: id,
    title,
    type,
    status: "DRAFT",
    frontmatter: { owner: "team" },
    contentJSON: [
      { type: "heading", props: { level: 1 }, content: [{ type: "text", text: title, styles: {} }] },
      { type: "paragraph", content: [{ type: "text", text: "body of " + title, styles: {} }] },
    ],
    acceptanceCriteria: [],
  };
}

const docs = [doc("seed", "Seed RFC"), doc("dep1", "Dependency One"), doc("dep2", "Dependency Two")];

describe("bundle assembly", () => {
  it("toBundleExport preserves order and projects each doc", () => {
    const b = toBundleExport(meta, docs);
    expect(b.meta.title).toBe("Agent: backend");
    expect(b.documents.map((d) => d.id)).toEqual(["seed", "dep1", "dep2"]);
    expect(b.documents[0]!.markdown).toContain("# Seed RFC");
  });

  it("bundleToMarkdown includes a TOC and every document", () => {
    const md = bundleToMarkdown(meta, docs);
    expect(md).toContain("# Agent: backend");
    expect(md).toContain("## Contents");
    expect(md).toContain("- Seed RFC (RFC)");
    expect(md).toContain("body of Dependency Two");
    // documents separated by horizontal rules
    expect(md.match(/\n---\n/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("bundleToJson + bundleToYaml round-trip to the same envelope", () => {
    expect(JSON.parse(bundleToJson(meta, docs))).toEqual(toBundleExport(meta, docs));
    expect(parseYaml(bundleToYaml(meta, docs))).toEqual(toBundleExport(meta, docs));
  });
});

describe("serializeBundle dispatch", () => {
  it("returns correct content type + extension per format", () => {
    expect(serializeBundle("markdown", meta, docs).extension).toBe("md");
    expect(serializeBundle("json", meta, docs).contentType).toContain("application/json");
    expect(serializeBundle("yaml", meta, docs).contentType).toContain("yaml");
  });
});

describe("serializeDocument dispatch", () => {
  it("markdown form is the standalone document (no bundle TOC)", () => {
    const out = serializeDocument("markdown", docs[0]!);
    expect(out.body).toContain("# Seed RFC");
    expect(out.body).not.toContain("## Contents");
  });
});

describe("resolveFormat", () => {
  it("prefers explicit ?format= over Accept", () => {
    expect(resolveFormat({ formatParam: "json", accept: "text/markdown" })).toBe("json");
    expect(resolveFormat({ formatParam: "yml", accept: null })).toBe("yaml");
    expect(resolveFormat({ formatParam: "md", accept: null })).toBe("markdown");
  });

  it("falls back to Accept header", () => {
    expect(resolveFormat({ formatParam: null, accept: "application/json" })).toBe("json");
    expect(resolveFormat({ formatParam: null, accept: "application/x-yaml" })).toBe("yaml");
    expect(resolveFormat({ formatParam: null, accept: "text/markdown" })).toBe("markdown");
  });

  it("defaults to markdown", () => {
    expect(resolveFormat({ formatParam: null, accept: null })).toBe("markdown");
    expect(resolveFormat({ formatParam: "weird", accept: "*/*" })).toBe("markdown");
  });
});
