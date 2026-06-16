import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";

import {
  blocknoteToMarkdown,
  extractAcceptanceCriteria,
  documentToMarkdown,
  documentToJson,
  documentToYaml,
  toDocumentExport,
  type ExportDocument,
} from "./serialize";

const sampleDoc = [
  { type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Title", styles: {} }] },
  { type: "paragraph", content: [{ type: "text", text: "Hello ", styles: {} }, { type: "text", text: "world", styles: { bold: true } }] },
  { type: "bulletListItem", content: [{ type: "text", text: "one", styles: {} }] },
  { type: "bulletListItem", content: [{ type: "text", text: "two", styles: {} }] },
  { type: "code", props: { code: "const x = 1;", language: "ts" } },
  { type: "mermaid", props: { code: "flowchart TD\n A-->B" } },
];

describe("blocknoteToMarkdown", () => {
  it("renders headings, paragraphs, bold, lists, code and mermaid", () => {
    const md = blocknoteToMarkdown(sampleDoc);
    expect(md).toContain("# Title");
    expect(md).toContain("Hello **world**");
    expect(md).toContain("- one");
    expect(md).toContain("- two");
    expect(md).toContain("```ts\nconst x = 1;\n```");
    expect(md).toContain("```mermaid\nflowchart TD\n A-->B\n```");
  });

  it("renders nested list children with indentation", () => {
    const doc = [
      {
        type: "bulletListItem",
        content: [{ type: "text", text: "parent", styles: {} }],
        children: [
          { type: "bulletListItem", content: [{ type: "text", text: "child", styles: {} }] },
        ],
      },
    ];
    const md = blocknoteToMarkdown(doc);
    expect(md).toContain("- parent");
    expect(md).toContain("  - child");
  });

  it("renders links", () => {
    const doc = [
      {
        type: "paragraph",
        content: [
          { type: "link", props: { href: "https://x.dev" }, content: [{ type: "text", text: "x", styles: {} }] },
        ],
      },
    ];
    expect(blocknoteToMarkdown(doc)).toContain("[x](https://x.dev)");
  });

  it("returns empty string for non-array input", () => {
    expect(blocknoteToMarkdown(null)).toBe("");
    expect(blocknoteToMarkdown({})).toBe("");
  });

  it("escapes structural markdown characters in prose", () => {
    const doc = [{ type: "paragraph", content: [{ type: "text", text: "a*b_c", styles: {} }] }];
    expect(blocknoteToMarkdown(doc)).toContain("a\\*b\\_c");
  });
});

describe("extractAcceptanceCriteria", () => {
  it("pulls bullet items under an 'Acceptance criteria' heading", () => {
    const doc = [
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Acceptance Criteria", styles: {} }] },
      { type: "bulletListItem", content: [{ type: "text", text: "must do X", styles: {} }] },
      { type: "bulletListItem", content: [{ type: "text", text: "must do Y", styles: {} }] },
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Risks", styles: {} }] },
      { type: "bulletListItem", content: [{ type: "text", text: "not a criterion", styles: {} }] },
    ];
    expect(extractAcceptanceCriteria(doc)).toEqual(["must do X", "must do Y"]);
  });

  it("returns empty when no acceptance heading present", () => {
    expect(extractAcceptanceCriteria(sampleDoc)).toEqual([]);
  });
});

function baseExportDoc(overrides: Partial<ExportDocument> = {}): ExportDocument {
  return {
    id: "doc1",
    slug: "title",
    title: "Title",
    type: "RFC",
    status: "APPROVED",
    frontmatter: { owner: "team", version: "1.0.0", implementation_state: "in_progress" },
    contentJSON: sampleDoc,
    acceptanceCriteria: ["criterion A"],
    ...overrides,
  };
}

describe("documentToMarkdown", () => {
  it("emits a YAML frontmatter fence with status/owner/version", () => {
    const md = documentToMarkdown(baseExportDoc());
    expect(md.startsWith("---\n")).toBe(true);
    const fence = md.split("---")[1]!;
    const fm = parseYaml(fence);
    expect(fm.title).toBe("Title");
    expect(fm.status).toBe("APPROVED");
    expect(fm.owner).toBe("team");
    expect(fm.version).toBe("1.0.0");
    expect(fm.implementation_state).toBe("in_progress");
  });

  it("appends an Acceptance Criteria section", () => {
    const md = documentToMarkdown(baseExportDoc());
    expect(md).toContain("## Acceptance Criteria");
    expect(md).toContain("- criterion A");
  });

  it("includes OpenAPI for API_SPEC docs", () => {
    const md = documentToMarkdown(
      baseExportDoc({ type: "API_SPEC", openapi: { source: "openapi: 3.1.0", format: "yaml" } }),
    );
    expect(md).toContain("## OpenAPI");
    expect(md).toContain("```yaml");
    expect(md).toContain("openapi: 3.1.0");
  });

  it("includes DBML + generated SQL for DB_SCHEMA docs", () => {
    const md = documentToMarkdown(
      baseExportDoc({ type: "DB_SCHEMA", dbml: { source: "Table t { id int }", sql: "CREATE TABLE t (id int);" } }),
    );
    expect(md).toContain("## Database Schema (DBML)");
    expect(md).toContain("```dbml");
    expect(md).toContain("### Generated SQL");
    expect(md).toContain("CREATE TABLE t");
  });
});

describe("documentToJson / documentToYaml", () => {
  it("JSON envelope carries structured fields + markdown body", () => {
    const json = JSON.parse(documentToJson(baseExportDoc()));
    expect(json.id).toBe("doc1");
    expect(json.acceptanceCriteria).toEqual(["criterion A"]);
    expect(typeof json.markdown).toBe("string");
    expect(json.markdown).toContain("# Title");
    expect(json.frontmatter.owner).toBe("team");
  });

  it("YAML round-trips to the same envelope as toDocumentExport", () => {
    const doc = baseExportDoc();
    const parsed = parseYaml(documentToYaml(doc));
    expect(parsed).toEqual(toDocumentExport(doc));
  });

  it("omits openapi/dbml keys when not present", () => {
    const json = JSON.parse(documentToJson(baseExportDoc()));
    expect("openapi" in json).toBe(false);
    expect("dbml" in json).toBe(false);
  });
});
