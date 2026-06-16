/**
 * ForgeSpecs collab server entrypoint (M4).
 *
 * Real Yjs websocket server: `ws` + y-protocols, room === documentId, Better
 * Auth handshake + shared RBAC, Postgres append-log persistence with debounced
 * compaction → contentJSON/contentText/Block projection + embedding refresh.
 *
 * Runs via tsx (see package.json `start`). Standalone process; shares
 * packages/db + packages/core with the web app so persistence and RBAC are
 * identical across both.
 */
import { start } from "./server";

function main(): void {
  const server = start();

  const shutdown = (signal: string): void => {
    // eslint-disable-next-line no-console
    console.log(`[collab] received ${signal}, shutting down…`);
    server.close(() => process.exit(0));
    // Failsafe: force-exit if connections linger.
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Only auto-run when executed directly (not when imported by tooling/tests).
if (process.env.NODE_ENV !== "test") {
  main();
}

export {};
