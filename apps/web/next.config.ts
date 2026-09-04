import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@placeholder/brain", "@placeholder/db"],
  agentRules: false,
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default config;
