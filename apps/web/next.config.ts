import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@maslow/brain", "@maslow/db"],
  agentRules: false,
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // A page fetched before its click is shown as fetched for this long, then
  // fetched again: fresh enough for a brain, far enough ahead to be ready.
  experimental: { staleTimes: { static: 30 } },
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
  // Our own pages frame each other in the room, so a page of ours is framed
  // only by our own site and no other, and no address of ours is told to one.
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
      ],
    },
  ],
};

export default config;
