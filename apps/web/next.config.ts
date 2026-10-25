import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // better-sqlite3 is a native addon; it must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
  // @agent-os/core ships TypeScript source, not a build artifact.
  transpilePackages: ["@agent-os/core"],
  turbopack: {
    // The monorepo root: the pnpm store and the `next` package both live above
    // `apps/web`. Pointing at `process.cwd()` puts them outside the root and
    // makes Turbopack unable to resolve `next/package.json`.
    root: path.resolve(process.cwd(), "../.."),
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
