import "server-only";

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { prisma, type Prisma } from "@forgespecs/db";
import {
  hasApiKey,
  fetchGithubRepo,
  walkRepo,
  readSnapshotFile,
  guessDocType,
  parseFrontmatter,
  titleFromMarkdown,
  markdownToBlockNote,
  summarizeFile,
  synthesizeDocs,
  type FileSummary,
  type WalkedFile,
} from "@forgespecs/ai";
import {
  decryptToken,
  parseAllowedRoots,
  resolveAllowedLocalPath,
  IngestPathError,
} from "@forgespecs/core/ingest";
import type { Scope } from "@forgespecs/core";

import {
  upsertIngestDocument,
  saveDocumentContent,
  createDependency,
  markIngestDocumentDeprecated,
} from "@/lib/actions/documents";

/**
 * Repo ingest orchestrator. Runs as the body of a GenerationJob (kind =
 * REPO_INGEST). Stages are idempotent so a resume/retry picks up at the failed
 * step:
 *
 *   1. fetch     — LOCAL: resolve allowlisted path. GITHUB: download tree to tmp.
 *   2. walk      — sha + classify every kept file; upsert RepoFile rows.
 *   3. verbatim  — upsert one Document per markdown/mdx, keyed by (project, slug).
 *   4. summarize — fast-model per-file structured summary (CODE only, skipped on key absent).
 *   5. synthesize — smart-model canonical taxonomy + DERIVES_FROM edges (skipped on key absent).
 *   6. finalize  — mark vanished docs DEPRECATED, stamp RepoIngestSource.lastIngestAt.
 *
 * Persists fine-grained progress on GenerationJob.progress so the UI can poll.
 * "AI never writes Postgres-of-record directly" — every Document/Block/edge
 * write goes through the existing server actions (upsertIngestDocument /
 * saveDocumentContent / createDependency / markIngestDocumentDeprecated).
 */

export interface IngestProgress {
  status: "pending" | "running" | "completed" | "failed";
  stage:
    | "fetch"
    | "walk"
    | "verbatim"
    | "summarize"
    | "synthesize"
    | "finalize"
    | "done";
  fetchedAt?: string;
  walkedFiles?: number;
  verbatim?: { created: number; updated: number; skipped: number };
  summarize?: { done: number; total: number };
  synthesize?: { emitted: number; error?: string };
  finalized?: boolean;
  ai?: { skipped: boolean; reason?: string };
  error?: string;
}

export interface IngestInput {
  kind: "LOCAL" | "GITHUB";
  /** LOCAL: absolute path. GITHUB: "owner/repo". */
  ref: string;
  branch?: string;
}

export async function runRepoIngestJob(generationJobId: string): Promise<void> {
  const job = await prisma.generationJob.findUnique({
    where: { id: generationJobId },
    select: {
      id: true,
      projectId: true,
      input: true,
      progress: true,
    },
  });
  if (!job) {
    console.error(`[ingest] job ${generationJobId} not found`);
    return;
  }
  const project = await prisma.project.findUnique({
    where: { id: job.projectId },
    select: { workspaceId: true },
  });
  if (!project) {
    await failJob(generationJobId, "Project not found.");
    return;
  }
  const scope: Scope = {
    kind: "project",
    workspaceId: project.workspaceId,
    projectId: job.projectId,
  };
  const input = (job.input ?? {}) as unknown as IngestInput;
  if (!input.kind || !input.ref) {
    await failJob(generationJobId, "Ingest input is missing kind or ref.");
    return;
  }

  let snapshotDir: string | null = null;
  let cleanup = true;
  try {
    await setProgress(generationJobId, (p) => {
      p.status = "running";
      p.stage = "fetch";
    });

    // ── stage 1: fetch ──────────────────────────────────────────────────────
    if (input.kind === "LOCAL") {
      const allowed = parseAllowedRoots(process.env.INGEST_LOCAL_ALLOWED_ROOTS);
      const real = resolveAllowedLocalPath({
        rawPath: input.ref,
        allowedRoots: allowed,
      });
      snapshotDir = real;
      cleanup = false; // never delete the user's actual repo
    } else {
      const tmpRoot = path.join(os.tmpdir(), "forgespecs-ingest", generationJobId);
      await fs.mkdir(tmpRoot, { recursive: true });
      snapshotDir = tmpRoot;
      const source = await prisma.repoIngestSource.findUnique({
        where: { projectId: job.projectId },
        select: { tokenCipher: true, tokenIv: true, tokenTag: true },
      });
      const token = await maybeDecryptToken(source);
      const maxBytes = readMaxBytes();
      await fetchGithubRepo({
        ref: input.ref,
        branch: input.branch,
        token,
        destDir: tmpRoot,
        maxBytes,
      });
    }
    await setProgress(generationJobId, (p) => {
      p.fetchedAt = new Date().toISOString();
      p.stage = "walk";
    });

    // ── stage 2: walk ───────────────────────────────────────────────────────
    const walked = await walkRepo(snapshotDir);
    // Upsert manifest, preserving previous summaries when sha is unchanged.
    const existingFiles = await prisma.repoFile.findMany({
      where: { projectId: job.projectId },
      select: {
        path: true,
        sha: true,
        summary: true,
        summaryModel: true,
      },
    });
    const existingByPath = new Map(existingFiles.map((r) => [r.path, r]));
    const seenPaths = new Set<string>();
    for (const f of walked) {
      seenPaths.add(f.path);
      const prev = existingByPath.get(f.path);
      const keepSummary = prev && prev.sha === f.sha;
      await prisma.repoFile.upsert({
        where: {
          projectId_path: { projectId: job.projectId, path: f.path },
        },
        create: {
          projectId: job.projectId,
          path: f.path,
          sha: f.sha,
          bytes: f.bytes,
          kind: f.kind,
          summary: null,
          summaryModel: null,
        },
        update: {
          sha: f.sha,
          bytes: f.bytes,
          kind: f.kind,
          summary: keepSummary ? prev.summary : null,
          summaryModel: keepSummary ? prev.summaryModel : null,
          lastSeenAt: new Date(),
        },
      });
    }
    await setProgress(generationJobId, (p) => {
      p.walkedFiles = walked.length;
      p.stage = "verbatim";
    });

    // ── stage 3: verbatim import ────────────────────────────────────────────
    const docFiles = walked.filter((f) => f.kind === "DOC");
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const verbatimDocs: Array<{ path: string; title: string; body: string }> = [];
    for (const f of docFiles) {
      let raw: string;
      try {
        raw = await readSnapshotFile(snapshotDir, f.path);
      } catch {
        skipped++;
        continue;
      }
      const { frontmatter, body } = parseFrontmatter(raw);
      const title =
        (frontmatter.title?.trim() || titleFromMarkdown(body) || path.basename(f.path)) ||
        f.path;
      const docType = (frontmatter.type as ReturnType<typeof guessDocType>) || guessDocType(f.path);
      const slug = slugForSourcePath(f.path);
      const res = await upsertIngestDocument({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        type: docType,
        title,
        slug,
        sourcePath: f.path,
      });
      const blocks = markdownToBlockNote(body, slug);
      await saveDocumentContent({
        documentId: res.id,
        contentJSON: blocks,
        scope,
      });
      verbatimDocs.push({ path: f.path, title, body });
      if (res.created) created++;
      else updated++;
    }
    await setProgress(generationJobId, (p) => {
      p.verbatim = { created, updated, skipped };
      p.stage = "summarize";
    });

    // ── stage 4: summarize CODE files (LLM, fast model) ─────────────────────
    const aiAvailable = hasApiKey();
    let summaryDone = 0;
    const codeFiles = walked.filter((f) => f.kind === "CODE");
    if (!aiAvailable) {
      await setProgress(generationJobId, (p) => {
        p.summarize = { done: 0, total: codeFiles.length };
        p.ai = { skipped: true, reason: "OPENROUTER_API_KEY unset" };
        p.stage = "finalize";
      });
    } else {
      for (const f of codeFiles) {
        const existing = await prisma.repoFile.findUnique({
          where: { projectId_path: { projectId: job.projectId, path: f.path } },
          select: { summary: true, sha: true },
        });
        if (existing?.summary) {
          summaryDone++;
          continue;
        }
        let body: string;
        try {
          body = await readSnapshotFile(snapshotDir, f.path);
        } catch {
          summaryDone++;
          continue;
        }
        // Hard limit: extremely large files are skipped as opaque to the
        // synthesizer (still kept as a manifest entry).
        if (body.length > 200_000) {
          await prisma.repoFile.update({
            where: { projectId_path: { projectId: job.projectId, path: f.path } },
            data: { summary: "skipped: file too large", summaryModel: null },
          });
          summaryDone++;
          continue;
        }
        try {
          const result = await summarizeFile({ path: f.path, body });
          await prisma.repoFile.update({
            where: { projectId_path: { projectId: job.projectId, path: f.path } },
            data: {
              summary: JSON.stringify(result.summary),
              summaryModel: result.model,
            },
          });
        } catch (err) {
          // A single-file failure must not fail the job — record an opaque
          // summary so the synthesizer at least sees the manifest entry.
          console.error(`[ingest] summarize failed for ${f.path}:`, err);
          await prisma.repoFile.update({
            where: { projectId_path: { projectId: job.projectId, path: f.path } },
            data: {
              summary: "summary failed",
              summaryModel: null,
            },
          });
        }
        summaryDone++;
        if (summaryDone % 5 === 0 || summaryDone === codeFiles.length) {
          await setProgress(generationJobId, (p) => {
            p.summarize = { done: summaryDone, total: codeFiles.length };
          });
        }
      }
      await setProgress(generationJobId, (p) => {
        p.summarize = { done: summaryDone, total: codeFiles.length };
        p.stage = "synthesize";
      });
    }

    // ── stage 5: synthesis ──────────────────────────────────────────────────
    let emitted = 0;
    let synthError: string | undefined;
    if (aiAvailable) {
      const summaryRows = await prisma.repoFile.findMany({
        where: { projectId: job.projectId, kind: "CODE", NOT: { summary: null } },
        select: { path: true, summary: true },
        take: 400,
      });
      const fileSummaries = summaryRows
        .map((r) => {
          try {
            return { path: r.path, summary: JSON.parse(r.summary ?? "") as FileSummary };
          } catch {
            return null;
          }
        })
        .filter((x): x is { path: string; summary: FileSummary } => x !== null);
      const manifest = walked.map((f) => ({
        path: f.path,
        kind: f.kind,
        bytes: f.bytes,
      }));
      try {
        const synth = await synthesizeDocs({
          verbatimDocs,
          fileSummaries,
          manifest,
        });
        for (const d of synth.docs) {
          const res = await upsertIngestDocument({
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            type: d.type,
            title: d.title,
            slug: d.slug,
            sourcePath: null,
          });
          const blocks = markdownToBlockNote(d.body, d.slug);
          await saveDocumentContent({
            documentId: res.id,
            contentJSON: blocks,
            scope,
          });
          // DERIVES_FROM provenance: for every verbatim source the model cited,
          // find the matching Document by sourcePath and write the edge.
          for (const sourcePath of d.derivesFrom) {
            const fromDoc = await prisma.document.findFirst({
              where: { projectId: job.projectId, sourcePath },
              select: { id: true },
            });
            if (!fromDoc) continue;
            try {
              await createDependency({
                fromDocId: res.id,
                toDocId: fromDoc.id,
                kind: "DERIVES_FROM",
                scope,
              });
            } catch (err) {
              // Edge creation is best-effort; never fail the whole job.
              console.error(`[ingest] edge ${res.id}→${fromDoc.id} failed:`, err);
            }
          }
          emitted++;
        }
      } catch (err) {
        console.error("[ingest] synthesis failed:", err);
        synthError = err instanceof Error ? err.message : String(err);
      }
    }
    await setProgress(generationJobId, (p) => {
      p.synthesize = synthError ? { emitted, error: synthError } : { emitted };
      p.stage = "finalize";
    });

    // ── stage 6: finalize ───────────────────────────────────────────────────
    // Deprecate verbatim docs whose source file disappeared this run.
    const allIngestedDocs = await prisma.document.findMany({
      where: {
        projectId: job.projectId,
        sourcePath: { not: null },
      },
      select: { id: true, sourcePath: true, status: true },
    });
    for (const doc of allIngestedDocs) {
      if (!doc.sourcePath) continue;
      if (seenPaths.has(doc.sourcePath)) continue;
      if (doc.status === "DEPRECATED") continue;
      try {
        await markIngestDocumentDeprecated({ documentId: doc.id, scope });
      } catch (err) {
        console.error(`[ingest] deprecate failed for ${doc.id}:`, err);
      }
    }
    await prisma.repoIngestSource.update({
      where: { projectId: job.projectId },
      data: { lastIngestAt: new Date() },
    });
    await setProgress(generationJobId, (p) => {
      p.finalized = true;
      p.stage = "done";
      p.status = "completed";
    });
    await prisma.generationJob.update({
      where: { id: generationJobId },
      data: { status: "COMPLETED", error: null },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Repo ingest failed.";
    const friendly = err instanceof IngestPathError ? msg : msg;
    await failJob(generationJobId, friendly);
  } finally {
    if (cleanup && snapshotDir) {
      await fs.rm(snapshotDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

async function setProgress(
  jobId: string,
  mutate: (p: IngestProgress) => void,
): Promise<void> {
  const row = await prisma.generationJob.findUnique({
    where: { id: jobId },
    select: { progress: true },
  });
  const current = (row?.progress as unknown as IngestProgress | undefined) ?? {
    status: "pending",
    stage: "fetch",
  };
  mutate(current);
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      progress: current as unknown as Prisma.InputJsonValue,
      ...(current.status === "running" ? { status: "RUNNING" } : {}),
    },
  });
}

async function failJob(jobId: string, error: string): Promise<void> {
  try {
    await setProgress(jobId, (p) => {
      p.status = "failed";
      p.error = error;
    });
  } catch {}
  await prisma.generationJob
    .update({
      where: { id: jobId },
      data: { status: "FAILED", error },
    })
    .catch(() => {});
}

async function maybeDecryptToken(
  source:
    | {
        tokenCipher: Uint8Array<ArrayBuffer> | null;
        tokenIv: Uint8Array<ArrayBuffer> | null;
        tokenTag: Uint8Array<ArrayBuffer> | null;
      }
    | null,
): Promise<string | undefined> {
  if (!source?.tokenCipher || !source.tokenIv || !source.tokenTag) return undefined;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is unset; cannot decrypt token");
  return decryptToken(
    {
      cipher: source.tokenCipher,
      iv: source.tokenIv,
      tag: source.tokenTag,
    },
    secret,
  );
}

function readMaxBytes(): number {
  const raw = process.env.INGEST_MAX_BYTES;
  if (!raw) return 104_857_600; // 100 MiB
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 104_857_600;
  return n;
}

/**
 * Deterministic slug per (projectId, sourcePath). Strips extensions and
 * non-alphanumerics so reruns hit the same row. Prefixed with `src-` so the
 * synthesizer-emitted `auto-*` slugs never collide.
 */
function slugForSourcePath(p: string): string {
  const cleaned = p
    .replace(/\.[^./]+$/, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `src-${cleaned.slice(0, 80) || "doc"}`;
}
