/**
 * Demo seed — creates a navigable workspace + project + a spread of documents
 * so the M1 UI has something to render. Idempotent on slugs/emails so it can be
 * re-run.
 *
 * Requires a live database. Author-only at M1 — do not run in CI:
 *   pnpm --filter @forgespecs/db db:seed
 */
import {
  PrismaClient,
  Role,
  DocumentType,
  DocumentStatus,
  ActivityType,
  TemplateScope,
} from "@prisma/client";
import { BUILTIN_TEMPLATES } from "@forgespecs/core/templates";

const prisma = new PrismaClient();

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

const DEMO_DOCS: Array<{
  type: DocumentType;
  title: string;
  status: DocumentStatus;
}> = [
  { type: DocumentType.VISION, title: "Product Vision", status: DocumentStatus.APPROVED },
  { type: DocumentType.PRD, title: "Collaboration PRD", status: DocumentStatus.REVIEW },
  { type: DocumentType.RFC, title: "Realtime Sync Architecture", status: DocumentStatus.DRAFT },
  { type: DocumentType.RFC, title: "Search & Retrieval", status: DocumentStatus.DRAFT },
  { type: DocumentType.ADR, title: "Use Yjs for the document body", status: DocumentStatus.APPROVED },
  { type: DocumentType.DB_SCHEMA, title: "Core Postgres Schema", status: DocumentStatus.IMPLEMENTING },
  { type: DocumentType.API_SPEC, title: "Public REST API", status: DocumentStatus.DRAFT },
  { type: DocumentType.WORKFLOW, title: "Review Workflow", status: DocumentStatus.DRAFT },
  { type: DocumentType.TASK_PLAN, title: "M1 Implementation Plan", status: DocumentStatus.IMPLEMENTING },
];

async function main() {
  // ── Demo user ──────────────────────────────────────────────────────────
  const user = await prisma.user.upsert({
    where: { email: "demo@forgespecs.dev" },
    update: {},
    create: {
      email: "demo@forgespecs.dev",
      name: "Demo User",
      emailVerified: true,
    },
  });

  // ── Workspace + owner membership ─────────────────────────────────────────
  const workspace = await prisma.workspace.upsert({
    where: { slug: "acme" },
    update: {},
    create: { slug: "acme", name: "Acme Engineering" },
  });

  await prisma.membership.upsert({
    where: {
      userId_workspaceId_projectId: {
        userId: user.id,
        workspaceId: workspace.id,
        projectId: null as unknown as string,
      },
    },
    update: { role: Role.OWNER },
    create: { userId: user.id, workspaceId: workspace.id, role: Role.OWNER },
  });

  // ── Project ──────────────────────────────────────────────────────────────
  const project = await prisma.project.upsert({
    where: { workspaceId_slug: { workspaceId: workspace.id, slug: "platform" } },
    update: {},
    create: {
      workspaceId: workspace.id,
      slug: "platform",
      name: "Platform",
      description: "The core ForgeSpecs platform specs.",
      createdById: user.id,
    },
  });

  // ── Documents ──────────────────────────────────────────────────────────
  const orderByType = new Map<DocumentType, number>();
  for (const spec of DEMO_DOCS) {
    const order = orderByType.get(spec.type) ?? 0;
    orderByType.set(spec.type, order + 1);

    const slug = slugify(spec.title);
    const doc = await prisma.document.upsert({
      where: { projectId_slug: { projectId: project.id, slug } },
      update: { status: spec.status },
      create: {
        projectId: project.id,
        authorId: user.id,
        type: spec.type,
        status: spec.status,
        title: spec.title,
        slug,
        frontmatter: { order, owner: "platform-team", version: "0.1.0" },
        contentText: `${spec.title} — placeholder body (rich editor lands in M2).`,
      },
    });

    await prisma.activityEvent.create({
      data: {
        workspaceId: workspace.id,
        actorId: user.id,
        type: ActivityType.DOCUMENT_CREATED,
        entityType: "document",
        entityId: doc.id,
        data: { title: spec.title, type: spec.type },
      },
    });
  }

  // ── A built-in-ish workspace template ────────────────────────────────────
  await prisma.template.upsert({
    where: { id: "seed-rfc-template" },
    update: {},
    create: {
      id: "seed-rfc-template",
      scope: TemplateScope.WORKSPACE,
      workspaceId: workspace.id,
      authorId: user.id,
      name: "RFC (standard)",
      description: "Context, proposal, alternatives, risks.",
      type: DocumentType.RFC,
      content: {
        sections: ["Context", "Proposal", "Alternatives", "Risks", "Rollout"],
      },
    },
  });

  // ── Built-in (global) templates ─────────────────────────────────────────
  // Each TemplateDefinition is a starter graph (multiple seed docs + edges).
  // The single-doc Template model can't hold the whole graph in its typed
  // columns, so we store the authored definition as a manifest in `content`
  // (the source of truth is BUILTIN_TEMPLATES; applyTemplate reads it by id).
  // scope GLOBAL + workspaceId null = visible to every workspace. Idempotent on
  // a deterministic id (`tpl-<id>`).
  for (const def of BUILTIN_TEMPLATES) {
    await prisma.template.upsert({
      where: { id: `tpl-${def.id}` },
      update: {
        name: def.name,
        description: def.description,
        content: def as unknown as object,
      },
      create: {
        id: `tpl-${def.id}`,
        scope: TemplateScope.GLOBAL,
        workspaceId: null,
        name: def.name,
        description: def.description,
        // Anchor type = the first seed doc's type (the manifest holds them all).
        type: def.docs[0]?.type ?? DocumentType.VISION,
        content: def as unknown as object,
      },
    });
  }

  console.log(
    `Seeded workspace "${workspace.name}" (/${workspace.slug}) with project "${project.name}", ${DEMO_DOCS.length} documents, and ${BUILTIN_TEMPLATES.length} built-in templates.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
