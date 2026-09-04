import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@placeholder/db"],
  agentRules: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default config;
