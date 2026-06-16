/**
 * Generation queue + producer for the resumable generate-architecture job, with
 * an INLINE FALLBACK (same contract as the embedding queue).
 *
 * The job's WORK is split in two so it respects the "AI never writes
 * Postgres-of-record except via human mutation paths" rule:
 *
 *   1. AI generation (this package, db + ai only): produce the doc tree + edges
 *      from the job's stored input. Deterministic, no Postgres-of-record writes.
 *   2. Materialization (the WEB layer, via createDocument/saveDocumentContent/
 *      createDependency): turn the tree into Documents + Dependency edges,
 *      idempotently per (jobId, docRef).
 *
 * Step 2 lives in the web app (it owns the server actions + RBAC session), so
 * the queued worker cannot run it directly. Therefore the producer accepts a
 * `runner` callback that performs BOTH steps for a job id; the web layer injects
 * it. With Redis, the job is enqueued and a worker (which the web process can
 * register via `registerGenerationRunner`) consumes it; WITHOUT Redis, the
 * runner is invoked inline (fire-and-forget) so a refresh still resumes via the
 * persisted GenerationJob.progress.
 *
 * This keeps orchestration crash-safe and resumable (plan risk #2) while never
 * importing web-only code into the jobs package.
 */
import { Queue, type JobsOptions } from "bullmq";

import { getConnection, isRedisEnabled } from "./connection";

export const GENERATION_QUEUE = "generation" as const;

export interface GenerationJobData {
  /** The GenerationJob row id (carries input + persisted progress). */
  generationJobId: string;
}

/** A runner that generates + materializes a job by id (injected by the web layer). */
export type GenerationRunner = (generationJobId: string) => Promise<void>;

let generationQueue: Queue<GenerationJobData> | undefined;
let registeredRunner: GenerationRunner | undefined;

/**
 * Register the runner the web layer uses to execute a generation job (generate
 * the tree + materialize through the human mutation paths). Required for the
 * inline fallback; the BullMQ worker also uses it when run in-process.
 */
export function registerGenerationRunner(runner: GenerationRunner): void {
  registeredRunner = runner;
}

export function getGenerationRunner(): GenerationRunner | undefined {
  return registeredRunner;
}

/** Lazily get (or create) the generation queue. Only call when Redis is enabled. */
export function getGenerationQueue(): Queue<GenerationJobData> {
  if (generationQueue) return generationQueue;
  generationQueue = new Queue<GenerationJobData>(GENERATION_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      // Generation is long + idempotent-on-resume; one retry covers a transient
      // provider blip without re-billing the whole tree (resume skips done docs).
      attempts: 2,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  });
  return generationQueue;
}

/**
 * Enqueue (or inline-run) a generation job. The GenerationJob row (input +
 * progress) must already exist — the worker/runner loads it by id, so resume is
 * automatic. Never throws into the caller.
 *
 * Dedupe: jobId === generationJobId so a double-submit collapses to one job.
 */
export async function enqueueGeneration(
  generationJobId: string,
): Promise<{ enqueued: boolean; inline: boolean }> {
  const runInline = (): void => {
    const runner = registeredRunner;
    if (!runner) {
      console.error(
        "[jobs] no generation runner registered; cannot run inline. " +
          "Call registerGenerationRunner() at app startup.",
      );
      return;
    }
    void runner(generationJobId).catch((err) => {
      console.error(`[jobs] inline generation failed for ${generationJobId}:`, err);
    });
  };

  if (!isRedisEnabled()) {
    runInline();
    return { enqueued: false, inline: true };
  }
  try {
    const opts: JobsOptions = { jobId: generationJobId };
    await getGenerationQueue().add("generate", { generationJobId }, opts);
    return { enqueued: true, inline: false };
  } catch (err) {
    console.error(
      `[jobs] generation enqueue failed, running inline for ${generationJobId}:`,
      err,
    );
    runInline();
    return { enqueued: false, inline: true };
  }
}

/** Close the queue (worker/producer shutdown, tests). */
export async function closeGenerationQueue(): Promise<void> {
  if (generationQueue) {
    await generationQueue.close().catch(() => {});
    generationQueue = undefined;
  }
}
