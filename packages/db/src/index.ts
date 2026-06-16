import { PrismaClient } from "@prisma/client";

/**
 * Singleton PrismaClient.
 *
 * In development Next.js hot-reload re-evaluates modules, which would otherwise
 * spawn a new client (and connection pool) on every change. We stash the
 * instance on globalThis to reuse it. In production a single module instance is
 * used, so the global is harmless.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Re-export everything from the generated client (types, enums, Prisma namespace).
export * from "@prisma/client";
export { PrismaClient } from "@prisma/client";
