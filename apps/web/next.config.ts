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
  serverExternalPackages: ["@prisma/client"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
