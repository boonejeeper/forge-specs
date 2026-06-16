/**
 * Pure ERD table-model transforms — the serialization layer behind the React
 * Flow ERD designer. The editable model is a normalized list of tables, each
 * with columns and foreign-key references; it round-trips to/from DBML (the
 * canonical serialization the doc carries / exports) and is also parseable from
 * the Mermaid `erDiagram` block M7 seeds.
 *
 *   DBML / Mermaid source ──parse──▶ ErdModel ──generate──▶ DBML  ──▶ SQL (@dbml/core)
 *
 * We hand-roll the DBML + Mermaid parsers (rather than only leaning on
 * @dbml/core) because the ERD designer needs a *stable, editable* intermediate
 * model with column-level handles, and because these must be deterministic + pure
 * for unit tests with no native deps. SQL export delegates to @dbml/core's
 * exporter, which round-trips DBML → Postgres/MySQL/etc.
 */

export interface ErdColumn {
  name: string;
  type: string;
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  /** FK target as `table.column`, if this column references another table. */
  ref?: { table: string; column: string };
}

export interface ErdTable {
  name: string;
  columns: ErdColumn[];
}

export interface ErdRelation {
  /** Many side (the table holding the FK). */
  fromTable: string;
  fromColumn: string;
  /** One side (the referenced table). */
  toTable: string;
  toColumn: string;
}

export interface ErdModel {
  tables: ErdTable[];
  relations: ErdRelation[];
}

// ── DBML → model ───────────────────────────────────────────────────────────────

/**
 * Parse a (subset of) DBML into the ERD model. Supports:
 *   Table name { col type [pk, not null, unique, ref: > other.col] ... }
 *   Ref: a.col > b.col   (top-level refs)
 * Comments (// and Note blocks) are ignored. This is intentionally a pragmatic
 * subset covering what we generate + what M7/users author, not the full grammar.
 */
export function parseDbml(source: string): ErdModel {
  const tables: ErdTable[] = [];
  const relations: ErdRelation[] = [];
  const tableByName = new Map<string, ErdTable>();

  const text = stripLineComments(source);
  let i = 0;
  const len = text.length;

  const skipWs = () => {
    while (i < len && /\s/.test(text[i]!)) i++;
  };

  while (i < len) {
    skipWs();
    if (i >= len) break;

    // Top-level "Ref:" relation.
    const refMatch = /^Ref\s*:?\s*/i.exec(text.slice(i));
    if (refMatch && /^Ref\b/i.test(text.slice(i))) {
      i += refMatch[0].length;
      const lineEnd = text.indexOf("\n", i);
      const line = text.slice(i, lineEnd === -1 ? len : lineEnd);
      const rel = parseRefLine(line);
      if (rel) relations.push(rel);
      i = lineEnd === -1 ? len : lineEnd + 1;
      continue;
    }

    // "Table name {" block.
    const tableMatch = /^Table\s+("?[\w.]+"?)\s*(\[[^\]]*\]\s*)?\{/i.exec(
      text.slice(i),
    );
    if (tableMatch) {
      const name = unquote(tableMatch[1]!);
      i += tableMatch[0].length;
      const bodyEnd = findMatchingBrace(text, i - 1);
      const body = text.slice(i, bodyEnd);
      const table: ErdTable = { name, columns: parseColumns(body, name, relations) };
      tables.push(table);
      tableByName.set(name, table);
      i = bodyEnd + 1;
      continue;
    }

    // Unknown token — skip to next line to stay robust.
    const nl = text.indexOf("\n", i);
    i = nl === -1 ? len : nl + 1;
  }

  // Promote inline column refs into top-level relations (dedupe).
  for (const t of tables) {
    for (const c of t.columns) {
      if (c.ref) {
        addRelation(relations, {
          fromTable: t.name,
          fromColumn: c.name,
          toTable: c.ref.table,
          toColumn: c.ref.column,
        });
      }
    }
  }

  // Backfill column.ref from top-level relations so the model is consistent.
  for (const r of relations) {
    const t = tableByName.get(r.fromTable);
    const col = t?.columns.find((c) => c.name === r.fromColumn);
    if (col && !col.ref) col.ref = { table: r.toTable, column: r.toColumn };
  }

  return { tables, relations };
}

function parseColumns(
  body: string,
  _tableName: string,
  _relations: ErdRelation[],
): ErdColumn[] {
  const columns: ErdColumn[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("Note") || line.startsWith("indexes")) continue;
    // name type [settings]
    const m = /^("?[\w]+"?)\s+([\w()<>, ]+?)(\s*\[([^\]]*)\])?\s*$/.exec(line);
    if (!m) continue;
    const name = unquote(m[1]!);
    const type = m[2]!.trim();
    const settings = (m[4] ?? "").toLowerCase();
    const col: ErdColumn = {
      name,
      type,
      pk: /\b(pk|primary key)\b/.test(settings),
      notNull: /\bnot null\b/.test(settings),
      unique: /\bunique\b/.test(settings),
    };
    const refM = /ref:\s*[<>-]\s*("?[\w]+"?)\.("?[\w]+"?)/.exec(m[4] ?? "");
    if (refM) {
      col.ref = { table: unquote(refM[1]!), column: unquote(refM[2]!) };
    }
    columns.push(col);
  }
  return columns;
}

function parseRefLine(line: string): ErdRelation | null {
  // a.col > b.col  |  a.col - b.col  |  a.col < b.col
  const m = /("?[\w]+"?)\.("?[\w]+"?)\s*([<>-])\s*("?[\w]+"?)\.("?[\w]+"?)/.exec(
    line,
  );
  if (!m) return null;
  const left = { table: unquote(m[1]!), column: unquote(m[2]!) };
  const op = m[3]!;
  const right = { table: unquote(m[4]!), column: unquote(m[5]!) };
  // "<" means left is the one-side; normalize so fromTable holds the FK (many).
  if (op === "<") {
    return {
      fromTable: right.table,
      fromColumn: right.column,
      toTable: left.table,
      toColumn: left.column,
    };
  }
  return {
    fromTable: left.table,
    fromColumn: left.column,
    toTable: right.table,
    toColumn: right.column,
  };
}

// ── Mermaid erDiagram → model ──────────────────────────────────────────────────

/**
 * Parse a Mermaid `erDiagram` into the ERD model. Supports entity blocks:
 *   ENTITY { type name PK|FK|"comment" ... }
 * and relationships:
 *   A ||--o{ B : label
 * Mermaid relationships don't name columns, so we synthesize FK columns from the
 * relationship label / target PK where possible; otherwise we record a
 * table-level relation with best-effort column names.
 */
export function parseMermaidErd(source: string): ErdModel {
  const tables: ErdTable[] = [];
  const relations: ErdRelation[] = [];
  const tableByName = new Map<string, ErdTable>();

  const text = source.replace(/^\s*erDiagram\s*/i, "");
  let i = 0;
  const len = text.length;

  while (i < len) {
    // entity block: NAME { ... }
    const blockM = /([A-Za-z_][\w-]*)\s*\{/.exec(text.slice(i));
    const relLine = nextRelationship(text, i);

    if (blockM && (!relLine || i + blockM.index <= relLine.at)) {
      const name = blockM[1]!;
      const braceOpen = i + blockM.index + blockM[0].length - 1;
      const braceClose = findMatchingBrace(text, braceOpen);
      const body = text.slice(braceOpen + 1, braceClose);
      const table: ErdTable = { name, columns: parseMermaidEntity(body) };
      tables.push(table);
      tableByName.set(name, table);
      i = braceClose + 1;
      continue;
    }

    if (relLine) {
      const rel = parseMermaidRelationship(relLine.line);
      if (rel) relations.push(rel);
      i = relLine.end;
      continue;
    }
    break;
  }

  // Ensure FK columns exist on the many-side for each relation.
  for (const r of relations) {
    const t = tableByName.get(r.fromTable);
    if (t && !t.columns.some((c) => c.name === r.fromColumn)) {
      t.columns.push({
        name: r.fromColumn,
        type: "integer",
        pk: false,
        notNull: false,
        unique: false,
        ref: { table: r.toTable, column: r.toColumn },
      });
    }
  }

  return { tables, relations };
}

function parseMermaidEntity(body: string): ErdColumn[] {
  const columns: ErdColumn[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    // type name [PK|FK|UK] ["comment"]
    const m = /^([\w()<>,[\]-]+)\s+([\w-]+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const type = m[1]!;
    const name = m[2]!;
    const rest = (m[3] ?? "").toUpperCase();
    columns.push({
      name,
      type,
      pk: /\bPK\b/.test(rest),
      notNull: /\bPK\b/.test(rest),
      unique: /\bUK\b/.test(rest),
    });
  }
  return columns;
}

function nextRelationship(
  text: string,
  from: number,
): { line: string; at: number; end: number } | null {
  const rel =
    /([A-Za-z_][\w-]*)\s*([|}o][|}o]?--[|{o][|{o]?|[|}o]\.\.[|{o])\s*([A-Za-z_][\w-]*)\s*:\s*([^\n]*)/.exec(
      text.slice(from),
    );
  if (!rel) return null;
  const at = from + rel.index;
  return { line: rel[0], at, end: at + rel[0].length };
}

function parseMermaidRelationship(line: string): ErdRelation | null {
  const m =
    /([A-Za-z_][\w-]*)\s*([|}o][|}o]?--[|{o][|{o]?|[|}o]\.\.[|{o])\s*([A-Za-z_][\w-]*)\s*:\s*(.*)/.exec(
      line,
    );
  if (!m) return null;
  const left = m[1]!;
  const cardinality = m[2]!;
  const right = m[3]!;
  const label = (m[4] ?? "").trim().replace(/["']/g, "");
  // Crow's foot: the "many" (}o / }| ) side holds the FK. Decide which side.
  const leftIsMany = /^[}o]/.test(cardinality);
  const many = leftIsMany ? left : right;
  const one = leftIsMany ? right : left;
  const fkCol = label || `${one.toLowerCase()}_id`;
  return {
    fromTable: many,
    fromColumn: fkCol,
    toTable: one,
    toColumn: "id",
  };
}

// ── model → DBML ───────────────────────────────────────────────────────────────

/** Serialize the ERD model to DBML (the canonical persisted/exported format). */
export function generateDbml(model: ErdModel): string {
  const out: string[] = [];
  for (const t of model.tables) {
    out.push(`Table ${quoteIfNeeded(t.name)} {`);
    for (const c of t.columns) {
      const settings: string[] = [];
      if (c.pk) settings.push("pk");
      if (c.notNull && !c.pk) settings.push("not null");
      if (c.unique) settings.push("unique");
      if (c.ref) settings.push(`ref: > ${c.ref.table}.${c.ref.column}`);
      const tail = settings.length ? ` [${settings.join(", ")}]` : "";
      out.push(`  ${quoteIfNeeded(c.name)} ${c.type}${tail}`);
    }
    out.push("}");
    out.push("");
  }
  // Emit relations not already inlined on a column.
  for (const r of model.relations) {
    const t = model.tables.find((tb) => tb.name === r.fromTable);
    const col = t?.columns.find((c) => c.name === r.fromColumn);
    if (col?.ref) continue; // already inline
    out.push(`Ref: ${r.fromTable}.${r.fromColumn} > ${r.toTable}.${r.toColumn}`);
  }
  return out.join("\n").trim() + "\n";
}

// ── model → Mermaid erDiagram ──────────────────────────────────────────────────

/** Serialize the ERD model to a Mermaid erDiagram (for the diagram surface). */
export function generateMermaidErd(model: ErdModel): string {
  const out: string[] = ["erDiagram"];
  for (const t of model.tables) {
    out.push(`  ${t.name} {`);
    for (const c of t.columns) {
      const tags = [c.pk ? "PK" : "", c.ref ? "FK" : ""].filter(Boolean).join(" ");
      out.push(`    ${sanitizeType(c.type)} ${c.name}${tags ? " " + tags : ""}`);
    }
    out.push("  }");
  }
  for (const r of model.relations) {
    out.push(`  ${r.toTable} ||--o{ ${r.fromTable} : "${r.fromColumn}"`);
  }
  return out.join("\n");
}

// ── helpers ────────────────────────────────────────────────────────────────────

function addRelation(list: ErdRelation[], rel: ErdRelation): void {
  const key = (r: ErdRelation) =>
    `${r.fromTable}.${r.fromColumn}>${r.toTable}.${r.toColumn}`;
  if (!list.some((r) => key(r) === key(rel))) list.push(rel);
}

function stripLineComments(s: string): string {
  return s.replace(/\/\/[^\n]*/g, "");
}

function unquote(s: string): string {
  return s.replace(/^"(.*)"$/, "$1");
}

function quoteIfNeeded(name: string): string {
  return /^[A-Za-z_]\w*$/.test(name) ? name : `"${name}"`;
}

function sanitizeType(type: string): string {
  // Mermaid entity types can't contain spaces/parens — collapse to a token.
  return type.replace(/\([^)]*\)/g, "").replace(/\s+/g, "_") || "text";
}

function findMatchingBrace(text: string, openIdx: number): number {
  let depth = 0;
  for (let j = openIdx; j < text.length; j++) {
    if (text[j] === "{") depth++;
    else if (text[j] === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return text.length;
}
