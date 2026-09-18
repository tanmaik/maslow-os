import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@maslow/brain", "@maslow/db"],
  agentRules: false,
  devIndicators: false,
  // A phone on the same network, or one reached through a tunnel, may look
  // at a laptop's stack, and a stack on a Maslow computer is reached at that
  // computer's own address, which the dev script names: the dev server
  // serves its own assets to those origins as it does to localhost, and to
  // no other computer's. Production never reads this.
  allowedDevOrigins: [
    "*.trycloudflare.com",
    ...(process.env.DEV_ORIGIN ? [process.env.DEV_ORIGIN] : []),
    "10.*.*.*",
    "192.168.*.*",
  ],
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // A page fetched before its click is shown as fetched for this long, then
  // fetched again: fresh enough for a brain, far enough ahead to be ready.
  experimental: { staleTimes: { static: 30 } },
  // The browser reports to PostHog through this origin, so a browser that
  // blocks PostHog's hosts still reports. PostHog's paths end in a slash,
  // which Next would otherwise redirect away.
  skipTrailingSlashRedirect: true,
  rewrites: async () => [
    // A desktop open through a deploy still saves its arrangement and asks
    // after ports at the addresses its bundle was built with. Renamed on
    // 2026-09-16; these go once every open desktop has reloaded.
    { source: "/room/desktop", destination: "/desktop/layout" },
    { source: "/room/:path*", destination: "/desktop/:path*" },
    { source: "/notices", destination: "/notifications" },
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
