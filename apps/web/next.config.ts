import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output for a minimal Docker runtime image.
  output: "standalone",
  // Workspace packages are shipped as TS source; let Next compile them.
  transpilePackages: [
    "@forgespecs/config",
    "@forgespecs/core",
    "@forgespecs/db",
  ],
  // In a monorepo, trace files from the repo root so standalone bundles the
  // workspace deps correctly.
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // The Prisma engine .so is a binary asset Next's tracer doesn't follow on its
  // own when @prisma/client is marked as a server-external package. Glob it in.
  outputFileTracingIncludes: {
    "*": [
      "../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**/*",
      "../../node_modules/.pnpm/@prisma+client@*/node_modules/@prisma/client/**/*",
      "../../node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines/**/*",
    ],
  },
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
