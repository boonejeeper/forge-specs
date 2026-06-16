import { describe, it, expect } from "vitest";
import { DocumentType, DependencyKind } from "@forgespecs/db";

import {
  BUILTIN_TEMPLATES,
  getTemplateDefinition,
  templateDocBody,
  templateGallery,
} from "./definitions";
import { extractAcceptanceCriteria } from "../export/serialize";
import { extractOpenApiSpec, extractErdSource } from "../graph/spec-extract";

describe("BUILTIN_TEMPLATES", () => {
  it("includes all nine named templates", () => {
    const names = BUILTIN_TEMPLATES.map((t) => t.name);
    for (const expected of [
      "SaaS",
      "Marketplace",
      "Agent Platform",
      "LMS",
      "E-Commerce",
      "Kubernetes Platform",
      "Event-Driven System",
      "Microservices",
      "Monolith",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("every template has unique ids and every doc key is unique within it", () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of BUILTIN_TEMPLATES) {
      const keys = t.docs.map((d) => d.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("every edge references existing doc keys and uses a valid kind", () => {
    const validKinds = new Set(Object.values(DependencyKind));
    for (const t of BUILTIN_TEMPLATES) {
      const keys = new Set(t.docs.map((d) => d.key));
      for (const e of t.edges) {
        expect(keys.has(e.from)).toBe(true);
        expect(keys.has(e.to)).toBe(true);
        expect(e.from).not.toBe(e.to);
        expect(validKinds.has(e.kind)).toBe(true);
      }
    }
  });

  it("every doc declares a valid DocumentType, a title and promptHints", () => {
    const validTypes = new Set(Object.values(DocumentType));
    for (const t of BUILTIN_TEMPLATES) {
      for (const d of t.docs) {
        expect(validTypes.has(d.type)).toBe(true);
        expect(d.title.length).toBeGreaterThan(0);
        expect(Array.isArray(d.promptHints)).toBe(true);
        expect(d.promptHints.length).toBeGreaterThan(0);
      }
    }
  });

  it("templateDocBody materializes a non-empty BlockNote array", () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const d of t.docs) {
        const body = templateDocBody(d) as unknown[];
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThan(0);
      }
    }
  });

  it("API_SPEC docs carry an extractable OpenAPI block and DB_SCHEMA docs an ERD", () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const d of t.docs) {
        const body = templateDocBody(d);
        if (d.type === DocumentType.API_SPEC) {
          expect(extractOpenApiSpec(body)).not.toBeNull();
        }
        if (d.type === DocumentType.DB_SCHEMA) {
          expect(extractErdSource(body)).not.toBeNull();
        }
      }
    }
  });

  it("RFC/PRD/Schema/API docs surface acceptance criteria where authored", () => {
    // The SaaS RFC includes an Acceptance criteria section.
    const saas = getTemplateDefinition("saas")!;
    const rfc = saas.docs.find((d) => d.key === "rfc-auth")!;
    expect(extractAcceptanceCriteria(templateDocBody(rfc)).length).toBeGreaterThan(0);
  });
});

describe("getTemplateDefinition / templateGallery", () => {
  it("resolves by id", () => {
    expect(getTemplateDefinition("saas")?.name).toBe("SaaS");
    expect(getTemplateDefinition("nope")).toBeUndefined();
  });

  it("gallery summarizes each template without bodies", () => {
    const gallery = templateGallery();
    expect(gallery.length).toBe(BUILTIN_TEMPLATES.length);
    const saas = gallery.find((g) => g.id === "saas")!;
    expect(saas.docCount).toBe(6);
    expect(saas.edgeCount).toBeGreaterThan(0);
    expect(saas.types).toContain(DocumentType.VISION);
  });
});
