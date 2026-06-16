import { describe, it, expect } from "vitest";

import {
  parseDbml,
  parseMermaidErd,
  generateDbml,
  generateMermaidErd,
  type ErdModel,
} from "./erd-model";

const dbmlSource = `Table users {
  id integer [pk]
  email varchar [not null, unique]
  name varchar
}

Table orders {
  id integer [pk]
  user_id integer [ref: > users.id]
  total integer [not null]
}`;

describe("parseDbml", () => {
  it("parses tables, columns, and settings", () => {
    const model = parseDbml(dbmlSource);
    expect(model.tables.map((t) => t.name)).toEqual(["users", "orders"]);
    const users = model.tables[0]!;
    expect(users.columns.find((c) => c.name === "id")!.pk).toBe(true);
    const email = users.columns.find((c) => c.name === "email")!;
    expect(email.notNull).toBe(true);
    expect(email.unique).toBe(true);
  });

  it("captures inline FK refs as relations and on the column", () => {
    const model = parseDbml(dbmlSource);
    expect(model.relations).toEqual([
      { fromTable: "orders", fromColumn: "user_id", toTable: "users", toColumn: "id" },
    ]);
    const fk = model.tables[1]!.columns.find((c) => c.name === "user_id")!;
    expect(fk.ref).toEqual({ table: "users", column: "id" });
  });

  it("parses top-level Ref lines (including the < orientation)", () => {
    const model = parseDbml(`Table a { id int [pk] }
Table b { a_id int }
Ref: users.id < orders.user_id`);
    // "<" normalizes so the many-side (orders) holds the FK.
    expect(model.relations).toContainEqual({
      fromTable: "orders",
      fromColumn: "user_id",
      toTable: "users",
      toColumn: "id",
    });
  });
});

describe("generateDbml round-trip", () => {
  it("regenerates an equivalent model", () => {
    const model = parseDbml(dbmlSource);
    const regenerated = parseDbml(generateDbml(model));
    expect(regenerated.tables.map((t) => t.name)).toEqual(
      model.tables.map((t) => t.name),
    );
    expect(regenerated.relations).toEqual(model.relations);
    const o = regenerated.tables.find((t) => t.name === "orders")!;
    expect(o.columns.find((c) => c.name === "user_id")!.ref).toEqual({
      table: "users",
      column: "id",
    });
  });
});

describe("parseMermaidErd", () => {
  const mermaid = `erDiagram
  USER ||--o{ ORDER : places
  USER {
    int id PK
    string email
  }
  ORDER {
    int id PK
    int user_id FK
  }`;

  it("parses entities and synthesizes FK relations", () => {
    const model = parseMermaidErd(mermaid);
    expect(model.tables.map((t) => t.name).sort()).toEqual(["ORDER", "USER"]);
    const user = model.tables.find((t) => t.name === "USER")!;
    expect(user.columns.find((c) => c.name === "id")!.pk).toBe(true);
    expect(model.relations).toContainEqual({
      fromTable: "ORDER",
      fromColumn: "places",
      toTable: "USER",
      toColumn: "id",
    });
  });

  it("can be converted to DBML", () => {
    const model = parseMermaidErd(mermaid);
    const dbml = generateDbml(model);
    expect(dbml).toContain("Table USER");
    expect(dbml).toContain("Table ORDER");
  });
});

describe("generateMermaidErd", () => {
  it("emits a valid-looking erDiagram with PK/FK tags", () => {
    const model: ErdModel = parseDbml(dbmlSource);
    const mermaid = generateMermaidErd(model);
    expect(mermaid.startsWith("erDiagram")).toBe(true);
    expect(mermaid).toContain("id PK");
    expect(mermaid).toContain("users ||--o{ orders");
  });
});
