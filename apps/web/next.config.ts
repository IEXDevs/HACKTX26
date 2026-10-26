import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["host.docker.internal", "127.0.0.1", "localhost"],
  serverExternalPackages: ["postgres", "@electric-sql/pglite", "@composio/core"],
  // @agent-os/core ships TypeScript source, not a build artifact.
  transpilePackages: ["@agent-os/core"],
  output: "standalone",
  outputFileTracingIncludes: { "/*": ["./src/lib/db/pg-migrations/**/*", "./src/lib/db/supabase-ca.crt"] },
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*", "../../.runtime/**/*", "./.env*"],
  },
  turbopack: {
    // The monorepo root: the pnpm store and the `next` package both live above
    // `apps/web`. Pointing at `process.cwd()` puts them outside the root and
    // makes Turbopack unable to resolve `next/package.json`.
    root: path.resolve(process.cwd(), "../.."),
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
    // The proxy buffers request bodies; workflow videos can be up to 200 MB.
    proxyClientMaxBodySize: "210mb",
  },
};

export default nextConfig;
