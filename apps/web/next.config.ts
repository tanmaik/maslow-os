import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@placeholder/brain", "@placeholder/db"],
  agentRules: false,
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The browser reports to PostHog through this origin, so a browser that
  // blocks PostHog's hosts still reports. PostHog's paths end in a slash,
  // which Next would otherwise redirect away.
  skipTrailingSlashRedirect: true,
  rewrites: async () => [
    {
      source: "/ingest/static/:path*",
      destination: "https://us-assets.i.posthog.com/static/:path*",
    },
    {
      source: "/ingest/:path*",
      destination: "https://us.i.posthog.com/:path*",
    },
  ],
  // No page of ours is framed by another site, and no address of ours is
  // told to one.
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
  ],
};

export default config;
