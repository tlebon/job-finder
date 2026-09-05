import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  /* instrumentation.ts is enabled by default in Next.js 16+ */

  turbopack: {
    // The form parser lives in the scraper's src and is imported here rather
    // than copied. The two database layers were duplicated by convention and
    // have since drifted; a parser exists to agree with its tests, and two
    // copies would eventually disagree with each other instead.
    //
    // tsconfig paths alone are not enough - Turbopack resolves modules with its
    // own alias table.
    root: path.join(__dirname, ".."),
    resolveAlias: {
      "@shared": path.join(__dirname, "..", "src"),
    },
  },
};

export default nextConfig;
