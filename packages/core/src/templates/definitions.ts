/**
 * Built-in template definitions (M10).
 *
 * A ForgeSpecs template is a *starter graph*: a set of seed Documents (Vision /
 * PRD / RFC / ADR / Schema / API skeletons) wired together with Dependency
 * edges, plus per-document `promptHints` an AI agent uses to flesh each doc out.
 *
 * Persistence note: the `Template` model is single-doc (one `type` + `content`).
 * A multi-doc definition is stored as a *manifest* in a marker Template row's
 * `content` JSON (type = VISION as the anchor, scope = GLOBAL, workspaceId null).
 * `applyTemplate` reads the manifest and creates the documents + edges. The seed
 * script (packages/db) and applyTemplate both consume `BUILTIN_TEMPLATES` so the
 * authored definition is the single source of truth.
 *
 * These are pure data — no DB, no provider — so they unit-test directly and the
 * seed script can author them without a live database.
 */
import { DocumentType, DependencyKind } from "@forgespecs/db";

import { type SeedBlock, seedBlocksToBlockNote } from "./blocks";

/** A seed document within a template definition. */
export interface TemplateDoc {
  /** Stable key, unique within the template — referenced by edges. */
  key: string;
  type: DocumentType;
  title: string;
  /** Flat seed blocks materialized into the doc body on apply. */
  body: SeedBlock[];
  /** Hints an AI agent uses to expand this doc (stored in frontmatter). */
  promptHints: string[];
}

/** A dependency edge between two seed docs (by key). */
export interface TemplateEdge {
  from: string;
  to: string;
  kind: DependencyKind;
}

/** A complete built-in template definition. */
export interface TemplateDefinition {
  /** Stable id (also the marker Template row id: `tpl-<id>`). */
  id: string;
  name: string;
  description: string;
  /** Lucide icon name for the gallery card. */
  icon: string;
  docs: TemplateDoc[];
  edges: TemplateEdge[];
}

// ── small authoring helpers ──────────────────────────────────────────────────

const h = (text: string, level: 1 | 2 | 3 = 2): SeedBlock => ({ kind: "heading", text, level });
const p = (text: string): SeedBlock => ({ kind: "paragraph", text });
const li = (text: string): SeedBlock => ({ kind: "bullet", text });
const code = (codeText: string, language = ""): SeedBlock => ({ kind: "code", code: codeText, language });
const mermaid = (codeText: string): SeedBlock => ({ kind: "mermaid", code: codeText });

/** Standard skeleton bodies reused across templates. */
function visionBody(product: string, audience: string): SeedBlock[] {
  return [
    h(`${product} — Vision`, 1),
    h("Problem"),
    p(`Describe the core problem ${product} solves for ${audience}.`),
    h("Goals"),
    li("Primary outcome"),
    li("Key differentiator"),
    h("Non-goals"),
    li("Out of scope for v1"),
    h("Success metrics"),
    li("North-star metric"),
  ];
}

function prdBody(product: string): SeedBlock[] {
  return [
    h(`${product} — Product Requirements`, 1),
    h("Overview"),
    p("Summarize the product and the slice this PRD covers."),
    h("User stories"),
    li("As a user, I can …"),
    h("Functional requirements"),
    li("Requirement 1"),
    h("Acceptance criteria"),
    li("Given … when … then …"),
  ];
}

function rfcBody(title: string): SeedBlock[] {
  return [
    h(title, 1),
    h("Context"),
    p("What is being proposed and why now."),
    h("Proposal"),
    p("The design."),
    h("Architecture"),
    mermaid("flowchart TD\n  Client --> API\n  API --> DB[(Database)]"),
    h("Alternatives"),
    li("Alternative A — rejected because …"),
    h("Risks"),
    li("Risk and mitigation"),
    h("Acceptance criteria"),
    li("System behavior X is verifiable"),
  ];
}

function adrBody(title: string): SeedBlock[] {
  return [
    h(title, 1),
    h("Status"),
    p("Proposed"),
    h("Context"),
    p("The forces at play."),
    h("Decision"),
    p("We will …"),
    h("Consequences"),
    li("Positive"),
    li("Negative / trade-off"),
  ];
}

function schemaBody(title: string, dbml: string): SeedBlock[] {
  return [
    h(title, 1),
    p("Core data model. The ERD designer renders the diagram below; the DBML block is the editable source."),
    mermaid(toMermaidErd(dbml)),
    code(dbml, "dbml"),
    h("Acceptance criteria"),
    li("Migrations apply cleanly"),
  ];
}

function apiBody(title: string, openapi: string): SeedBlock[] {
  return [
    h(title, 1),
    p("Public contract. The OpenAPI explorer renders the spec below."),
    code(openapi, "yaml"),
    h("Acceptance criteria"),
    li("Endpoints conform to the contract"),
  ];
}

/** Minimal Mermaid erDiagram fallback derived from a DBML-ish hint. */
function toMermaidErd(_dbml: string): string {
  return "erDiagram\n  USER ||--o{ ACCOUNT : has";
}

const baseOpenApi = (title: string): string =>
  `openapi: 3.1.0
info:
  title: ${title}
  version: 0.1.0
paths:
  /health:
    get:
      summary: Health check
      responses:
        "200":
          description: OK`;

const baseDbml = (entity: string): string =>
  `Table ${entity} {
  id uuid [pk]
  created_at timestamptz
}`;

// ── the nine built-in templates ──────────────────────────────────────────────

export const BUILTIN_TEMPLATES: TemplateDefinition[] = [
  {
    id: "saas",
    name: "SaaS",
    description: "Multi-tenant SaaS starter: vision, PRD, auth + billing RFC, schema, API.",
    icon: "Layers",
    docs: [
      { key: "vision", type: DocumentType.VISION, title: "SaaS Vision", body: visionBody("SaaS Platform", "teams"), promptHints: ["Define ICP", "Pricing tiers"] },
      { key: "prd", type: DocumentType.PRD, title: "Core Product PRD", body: prdBody("SaaS Platform"), promptHints: ["Onboarding flow", "Billing UX"] },
      { key: "rfc-auth", type: DocumentType.RFC, title: "Auth & Multi-tenancy", body: rfcBody("Auth & Multi-tenancy"), promptHints: ["Tenant isolation model", "RBAC"] },
      { key: "adr-billing", type: DocumentType.ADR, title: "Use Stripe for billing", body: adrBody("Use Stripe for billing"), promptHints: ["Webhooks", "Dunning"] },
      { key: "schema", type: DocumentType.DB_SCHEMA, title: "Tenant Schema", body: schemaBody("Tenant Schema", baseDbml("tenant")), promptHints: ["Row-level isolation"] },
      { key: "api", type: DocumentType.API_SPEC, title: "REST API", body: apiBody("REST API", baseOpenApi("SaaS API")), promptHints: ["Versioning", "Pagination"] },
    ],
    edges: [
      { from: "prd", to: "vision", kind: DependencyKind.DERIVES_FROM },
      { from: "rfc-auth", to: "prd", kind: DependencyKind.IMPLEMENTS },
      { from: "adr-billing", to: "prd", kind: DependencyKind.REFERENCES },
      { from: "schema", to: "rfc-auth", kind: DependencyKind.IMPLEMENTS },
      { from: "api", to: "rfc-auth", kind: DependencyKind.IMPLEMENTS },
    ],
  },
  {
    id: "marketplace",
    name: "Marketplace",
    description: "Two-sided marketplace: supply/demand vision, listings + payments RFCs, ledger schema.",
    icon: "Store",
    docs: [
      { key: "vision", type: DocumentType.VISION, title: "Marketplace Vision", body: visionBody("Marketplace", "buyers and sellers"), promptHints: ["Liquidity strategy", "Take rate"] },
      { key: "prd", type: DocumentType.PRD, title: "Listings & Search PRD", body: prdBody("Marketplace"), promptHints: ["Listing lifecycle", "Search ranking"] },
      { key: "rfc-payments", type: DocumentType.RFC, title: "Payments & Payouts", body: rfcBody("Payments & Payouts"), promptHints: ["Escrow", "Split payments"] },
      { key: "rfc-trust", type: DocumentType.RFC, title: "Trust & Safety", body: rfcBody("Trust & Safety"), promptHints: ["Reviews", "Fraud"] },
      { key: "schema", type: DocumentType.DB_SCHEMA, title: "Ledger Schema", body: schemaBody("Ledger Schema", baseDbml("ledger_entry")), promptHints: ["Double-entry"] },
      { key: "api", type: DocumentType.API_SPEC, title: "Marketplace API", body: apiBody("Marketplace API", baseOpenApi("Marketplace API")), promptHints: ["Webhooks for sellers"] },
    ],
    edges: [
      { from: "prd", to: "vision", kind: DependencyKind.DERIVES_FROM },
      { from: "rfc-payments", to: "prd", kind: DependencyKind.IMPLEMENTS },
      { from: "rfc-trust", to: "prd", kind: DependencyKind.IMPLEMENTS },
      { from: "schema", to: "rfc-payments", kind: DependencyKind.IMPLEMENTS },
      { from: "api", to: "prd", kind: DependencyKind.IMPLEMENTS },
    ],
  },
  {
    id: "agent-platform",
    name: "Agent Platform",
    description: "Autonomous-agent OS: orchestration RFC, tool registry, memory schema, agent API.",
    icon: "Bot",
    docs: [
      { key: "vision", type: DocumentType.VISION, title: "Agent Platform Vision", body: visionBody("Agent Platform", "developers"), promptHints: ["Autonomy levels", "Safety"] },
      { key: "prd", type: DocumentType.PRD, title: "Agent Runtime PRD", body: prdBody("Agent Platform"), promptHints: ["Task graph", "Human-in-the-loop"] },
      { key: "rfc-orchestration", type: DocumentType.RFC, title: "Agent Orchestration", body: rfcBody("Agent Orchestration"), promptHints: ["Planner/executor", "Resumable jobs"] },
      { key: "rfc-tools", type: DocumentType.RFC, title: "Tool Registry & MCP", body: rfcBody("Tool Registry & MCP"), promptHints: ["Tool schemas", "Permissions"] },
      { key: "schema", type: DocumentType.DB_SCHEMA, title: "Memory & Runs Schema", body: schemaBody("Memory & Runs Schema", baseDbml("agent_run")), promptHints: ["Vector memory", "Run audit"] },
      { key: "api", type: DocumentType.API_SPEC, title: "Agent API", body: apiBody("Agent API", baseOpenApi("Agent API")), promptHints: ["Streaming", "Tool-call protocol"] },
    ],
    edges: [
      { from: "prd", to: "vision", kind: DependencyKind.DERIVES_FROM },
      { from: "rfc-orchestration", to: "prd", kind: DependencyKind.IMPLEMENTS },
      { from: "rfc-tools", to: "rfc-orchestration", kind: DependencyKind.REFERENCES },
      { from: "schema", to: "rfc-orchestration", kind: DependencyKind.IMPLEMENTS },
      { from: "api", to: "rfc-tools", kind: DependencyKind.IMPLEMENTS },
    ],
  },
  {
    id: "lms",
    name: "LMS",
    description: "Learning platform: courses PRD, progress-tracking RFC, content schema, learner API.",
    icon: "GraduationCap",
    docs: [
      { key: "vision", type: DocumentType.VISION, title: "LMS Vision", body: visionBody("Learning Platform", "learners and instructors"), promptHints: ["Pedagogy", "Engagement"] },
      { key: "prd", type: DocumentType.PRD, title: "Courses & Lessons PRD", body: prdBody("Learning Platform"), promptHints: ["Course authoring", "Assessments"] },
      { key: "rfc-progress", type: DocumentType.RFC, title: "Progress & Mastery Tracking", body: rfcBody("Progress & Mastery Tracking"), promptHints: ["Spaced repetition", "xAPI"] },
      { key: "adr-video", type: DocumentType.ADR, title: "Video delivery via HLS", body: adrBody("Video delivery via HLS"), promptHints: ["CDN", "DRM"] },
      { key: "schema", type: DocumentType.DB_SCHEMA, title: "Content Schema", body: schemaBody("Content Schema", baseDbml("course")), promptHints: ["Enrollment", "Progress"] },
      { key: "api", type: DocumentType.API_SPEC, title: "Learner API", body: apiBody("Learner API", baseOpenApi("LMS API")), promptHints: ["Progress sync"] },
    ],
    edges: [
      { from: "prd", to: "vision", kind: DependencyKind.DERIVES_FROM },
      { from: "rfc-progress", to: "prd", kind: DependencyKind.IMPLEMENTS },
      { from: "adr-video", to: "prd", kind: DependencyKind.REFERENCES },
      { from: "schema", to: "rfc-progress", kind: DependencyKind.IMPLEMENTS },
      { from: "api", to: "rfc-progress", kind: DependencyKind.IMPLEMENTS },
    ],
  },
  {
    id: "ecommerce",
    name: "E-Commerce",
    description: "Storefront + checkout: catalog PRD, cart/checkout RFC, orders schema, storefront API.",
    icon: "ShoppingCart",
    docs: [
      { key: "vision", type: DocumentType.VISION, title: "E-Commerce Vision", body: visionBody("Storefront", "shoppers"), promptHints: ["Conversion", "AOV"] },
      { key: "prd", type: DocumentType.PRD, title: "Catalog & Checkout PRD", body: prdBody("Storefront"), promptHints: ["Cart UX", "Promotions"] },
      { key: "rfc-checkout", type: DocumentType.RFC, title: "Cart & Checkout", body: rfcBody("Cart & Checkout"), promptHints: ["Idempotent orders", "Tax/shipping"] },
      { key: "rfc-inventory", type: DocumentType.RFC, title: "Inventory & Fulfillment", body: rfcBody("Inventory & Fulfillment"), promptHints: ["Reservations", "Backorders"] },
      { key: "schema", type: DocumentType.DB_SCHEMA, title: "Orders Schema", body: schemaBody("Orders Schema", baseDbml("order")), promptHints: ["Line items", "Payments"] },
      { key: "api", type: DocumentType.API_SPEC, title: "Storefront API", body: apiBody("Storefront API", baseOpenApi("Storefront API")), promptHints: ["Cart endpoints"] },
    ],
    edges: [
      { from: "prd", to: "vision", kind: DependencyKind.DERIVES_FROM },
      { from: "rfc-checkout", to: "prd", kind: DependencyKind.IMPLEMENTS },
      { from: "rfc-inventory", to: "prd", kind: DependencyKind.IMPLEMENTS },
      { from: "schema", to: "rfc-checkout", kind: DependencyKind.IMPLEMENTS },
      { from: "api", to: "rfc-checkout", kind: DependencyKind.IMPLEMENTS },
    ],
  },
  {
    id: "kubernetes-platform",
    name: "Kubernetes Platform",
    description: "Internal developer platform on K8s: control-plane RFC, GitOps ADR, cluster schema.",
    icon: "Boxes",
    docs: [
      { key: "vision", type: DocumentType.VISION, title: "Platform Vision", body: visionBody("Kubernetes Platform", "internal teams"), promptHints: ["Golden paths", "Self-service"] },
      { key: "prd", type: DocumentType.PRD, title: "Developer Platform PRD", body: prdBody("Kubernetes Platform"), promptHints: ["Service catalog", "Guardrails"] },
      { key: "rfc-controlplane", type: DocumentType.RFC, title: "Control Plane & Operators", body: rfcBody("Control Plane & Operators"), promptHints: ["CRDs", "Reconciliation"] },
      { key: "adr-gitops", type: DocumentType.ADR, title: "GitOps via Argo CD", body: adrBody("GitOps via Argo CD"), promptHints: ["App-of-apps", "Drift"] },
      { key: "schema", type: DocumentType.DB_SCHEMA, title: "Cluster Inventory Schema", body: schemaBody("Cluster Inventory Schema", baseDbml("workload")), promptHints: ["Namespaces", "Quotas"] },
      { key: "runbook", type: DocumentType.RUNBOOK, title: "Cluster Operations Runbook", body: [h("Cluster Operations Runbook", 1), h("Upgrade procedure"), li("Drain nodes"), li("Rollback plan")], promptHints: ["Incident response"] },
    ],
    edges: [
      { from: "prd", to: "vision", kind: DependencyKind.DERIVES_FROM },
      { from: "rfc-controlplane", to: "prd", kind: DependencyKind.IMPLEMENTS },
      { from: "adr-gitops", to: "rfc-controlplane", kind: DependencyKind.REFERENCES },
      { from: "schema", to: "rfc-controlplane", kind: DependencyKind.IMPLEMENTS },
      { from: "runbook", to: "rfc-controlplane", kind: DependencyKind.REFERENCES },
    ],
  },
  {
    id: "event-driven",
    name: "Event-Driven System",
    description: "Async event backbone: event-bus RFC, schema-registry ADR, event-store schema.",
    icon: "Radio",
    docs: [
      { key: "vision", type: DocumentType.VISION, title: "Event Platform Vision", body: visionBody("Event-Driven System", "service teams"), promptHints: ["Decoupling", "Replayability"] },
      { key: "rfc-bus", type: DocumentType.RFC, title: "Event Bus & Delivery", body: rfcBody("Event Bus & Delivery"), promptHints: ["At-least-once", "Ordering", "DLQ"] },
      { key: "rfc-cqrs", type: DocumentType.RFC, title: "CQRS & Projections", body: rfcBody("CQRS & Projections"), promptHints: ["Read models", "Idempotency"] },
      { key: "adr-registry", type: DocumentType.ADR, title: "Schema Registry with Avro", body: adrBody("Schema Registry with Avro"), promptHints: ["Compatibility", "Evolution"] },
      { key: "schema", type: DocumentType.DB_SCHEMA, title: "Event Store Schema", body: schemaBody("Event Store Schema", baseDbml("event")), promptHints: ["Append-only", "Snapshots"] },
      { key: "api", type: DocumentType.API_SPEC, title: "Ingestion API", body: apiBody("Ingestion API", baseOpenApi("Event Ingestion API")), promptHints: ["Batch ingest"] },
    ],
    edges: [
      { from: "rfc-bus", to: "vision", kind: DependencyKind.DERIVES_FROM },
      { from: "rfc-cqrs", to: "rfc-bus", kind: DependencyKind.REFERENCES },
      { from: "adr-registry", to: "rfc-bus", kind: DependencyKind.REFERENCES },
      { from: "schema", to: "rfc-cqrs", kind: DependencyKind.IMPLEMENTS },
      { from: "api", to: "rfc-bus", kind: DependencyKind.IMPLEMENTS },
    ],
  },
  {
    id: "microservices",
    name: "Microservices",
    description: "Service-oriented architecture: service-decomposition RFC, API gateway, per-service schemas.",
    icon: "Network",
    docs: [
      { key: "vision", type: DocumentType.VISION, title: "Microservices Vision", body: visionBody("Microservices Architecture", "engineering org"), promptHints: ["Bounded contexts", "Team topology"] },
      { key: "rfc-decomposition", type: DocumentType.RFC, title: "Service Decomposition", body: rfcBody("Service Decomposition"), promptHints: ["DDD boundaries", "Data ownership"] },
      { key: "rfc-gateway", type: DocumentType.RFC, title: "API Gateway & Service Mesh", body: rfcBody("API Gateway & Service Mesh"), promptHints: ["mTLS", "Routing", "Resilience"] },
      { key: "adr-comms", type: DocumentType.ADR, title: "Sync vs async communication", body: adrBody("Sync vs async communication"), promptHints: ["gRPC", "Sagas"] },
      { key: "schema", type: DocumentType.DB_SCHEMA, title: "Per-Service Schema", body: schemaBody("Per-Service Schema", baseDbml("service_entity")), promptHints: ["Database per service"] },
      { key: "api", type: DocumentType.API_SPEC, title: "Gateway API", body: apiBody("Gateway API", baseOpenApi("Gateway API")), promptHints: ["BFF pattern"] },
    ],
    edges: [
      { from: "rfc-decomposition", to: "vision", kind: DependencyKind.DERIVES_FROM },
      { from: "rfc-gateway", to: "rfc-decomposition", kind: DependencyKind.REFERENCES },
      { from: "adr-comms", to: "rfc-decomposition", kind: DependencyKind.REFERENCES },
      { from: "schema", to: "rfc-decomposition", kind: DependencyKind.IMPLEMENTS },
      { from: "api", to: "rfc-gateway", kind: DependencyKind.IMPLEMENTS },
    ],
  },
  {
    id: "monolith",
    name: "Monolith",
    description: "Modular monolith: module-boundaries RFC, layered-architecture ADR, single schema.",
    icon: "Box",
    docs: [
      { key: "vision", type: DocumentType.VISION, title: "Monolith Vision", body: visionBody("Modular Monolith", "a small team"), promptHints: ["Simplicity", "Velocity"] },
      { key: "prd", type: DocumentType.PRD, title: "Application PRD", body: prdBody("Modular Monolith"), promptHints: ["Feature modules"] },
      { key: "rfc-modules", type: DocumentType.RFC, title: "Module Boundaries", body: rfcBody("Module Boundaries"), promptHints: ["Internal APIs", "Enforced boundaries"] },
      { key: "adr-layering", type: DocumentType.ADR, title: "Layered architecture", body: adrBody("Layered architecture"), promptHints: ["Hexagonal", "Dependency rule"] },
      { key: "schema", type: DocumentType.DB_SCHEMA, title: "Application Schema", body: schemaBody("Application Schema", baseDbml("entity")), promptHints: ["Single database"] },
      { key: "api", type: DocumentType.API_SPEC, title: "Application API", body: apiBody("Application API", baseOpenApi("Application API")), promptHints: ["Monolithic REST"] },
    ],
    edges: [
      { from: "prd", to: "vision", kind: DependencyKind.DERIVES_FROM },
      { from: "rfc-modules", to: "prd", kind: DependencyKind.IMPLEMENTS },
      { from: "adr-layering", to: "rfc-modules", kind: DependencyKind.REFERENCES },
      { from: "schema", to: "rfc-modules", kind: DependencyKind.IMPLEMENTS },
      { from: "api", to: "rfc-modules", kind: DependencyKind.IMPLEMENTS },
    ],
  },
];

const BY_ID = new Map(BUILTIN_TEMPLATES.map((t) => [t.id, t]));

export function getTemplateDefinition(id: string): TemplateDefinition | undefined {
  return BY_ID.get(id);
}

/** Materialize a template doc's body into a BlockNote document array. */
export function templateDocBody(doc: TemplateDoc): unknown {
  return seedBlocksToBlockNote(doc.body);
}

/** Lightweight gallery listing (no bodies) for the templates UI. */
export interface TemplateGalleryItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  docCount: number;
  edgeCount: number;
  /** Distinct document types this template seeds, in order. */
  types: DocumentType[];
}

export function templateGallery(): TemplateGalleryItem[] {
  return BUILTIN_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    docCount: t.docs.length,
    edgeCount: t.edges.length,
    types: [...new Set(t.docs.map((d) => d.type))],
  }));
}
