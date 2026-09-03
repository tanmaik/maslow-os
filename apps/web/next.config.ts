import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@placeholder/db"],
  agentRules: false,
};

export default config;
