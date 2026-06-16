/**
 * BullMQ worker entrypoint for background AI / async embedding.
 *
 * WHERE IT RUNS: a standalone Node process (run `pnpm --filter @forgespecs/jobs
 * worker`, or via docker-compose as a `worker` service). It is intentionally a
 * separate process from web + collab so heavy embedding/AI work never blocks a
 * request or the collab event loop, and so it can be scaled independently. It
 * shares packages/db + packages/ai with both, so behaviour is identical to the
 * inline fallback.
 *
 * IF REDIS IS ABSENT: the worker logs and exits 0 — there is nothing to consume
 * because producers run inline. This keeps `docker compose up` honest when Redis
 * is not configured rather than crash-looping.
 *
 * Build/typecheck-clean without a running Redis: nothing here connects at import;
 * `start()` is only invoked when run directly with Redis enabled.
 */
import { Worker } from "bullmq";
import { prisma } from "@forgespecs/db";

import { getConnection, isRedisEnabled, closeConnection } from "./connection";
import { EMBEDDING_QUEUE, type EmbedDocumentJob } from "./queues";
import { runEmbedDocument } from "./processor";
import {
  GENERATION_QUEUE,
  getGenerationRunner,
  type GenerationJobData,
} from "./generation-queue";

export function startWorker(): Worker<EmbedDocumentJob> {
  const worker = new Worker<EmbedDocumentJob>(
    EMBEDDING_QUEUE,
    async (job) => {
      const { documentId } = job.data;
      const result = await runEmbedDocument(prisma, documentId);
      return result;
    },
    {
      connection: getConnection(),
      concurrency: Number(process.env.JOBS_CONCURRENCY ?? 4),
    },
  );

  worker.on("completed", (job, result) => {
    console.log(`[worker] embed ${job.data.documentId} →`, result);
  });
  worker.on("failed", (job, err) => {
    console.error(`[worker] embed ${job?.data.documentId} failed:`, err.message);
  });

  return worker;
}

/**
 * Start the generation worker — consumes generate-architecture jobs. It runs the
 * injected runner (generate tree + materialize via the web mutation paths), which
 * is resumable + idempotent on (jobId, docRef) via the persisted GenerationJob
 * progress. Only meaningful in a process that has registered a runner.
 */
export function startGenerationWorker(): Worker<GenerationJobData> {
  const worker = new Worker<GenerationJobData>(
    GENERATION_QUEUE,
    async (job) => {
      const runner = getGenerationRunner();
      if (!runner) {
        throw new Error(
          "No generation runner registered in this worker process. " +
            "Call registerGenerationRunner() before starting the generation worker.",
        );
      }
      await runner(job.data.generationJobId);
    },
    {
      connection: getConnection(),
      // Generation is heavy + long; keep concurrency low.
      concurrency: Number(process.env.GENERATION_CONCURRENCY ?? 2),
    },
  );

  worker.on("failed", (job, err) => {
    console.error(
      `[worker] generation ${job?.data.generationJobId} failed:`,
      err.message,
    );
  });

  return worker;
}

async function main(): Promise<void> {
  if (!isRedisEnabled()) {
    console.log(
      "[worker] REDIS_URL not set — nothing to do (producers run inline). Exiting.",
    );
    return;
  }
  console.log("[worker] starting embedding worker…");
  const worker = startWorker();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] received ${signal}, shutting down…`);
    await worker.close();
    await closeConnection();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

/**
 * Only auto-run when this file is the process ENTRYPOINT (i.e. `tsx
 * src/worker.ts` / the docker `worker` service). When merely imported — by the
 * web app (which imports startGenerationWorker), by tests, or during `next build`
 * — `main()` must NOT run, otherwise the build log gets `[worker] …` noise and,
 * worse, a stray embedding worker would spin up in the web process.
 */
function isEntrypoint(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  const entry = process.argv[1] ?? "";
  return /worker(\.[cm]?[jt]s)?$/.test(entry);
}

if (isEntrypoint()) {
  void main();
}
