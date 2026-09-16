import "./globals.css";

import { MotionConfig } from "motion/react";
import { type ReactNode } from "react";

import { Analytics } from "@/components/analytics";
import { DevToolbar } from "@/components/dev-toolbar";
import { GlassFilter } from "@/components/glass";
import { beforePaint } from "@/components/look";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

// On a phone Maslow is an app of its own: added to the home screen it
// opens without the browser's chrome, edge to edge.
export const metadata = {
  title: "Maslow",
  // The status bar is the app's own, so the desktop reaches the top of the
  // screen rather than stopping under a bar of the browser's colour.
  appleWebApp: {
    capable: true,
    title: "Maslow",
    statusBarStyle: "black-translucent",
  },
};
// Edge to edge, and nothing zooms: a phone that grows the page when a
// field is touched, or on a double tap, is a phone reading a document.
export const viewport = {
  viewportFit: "cover",
  // The keyboard resizes the page rather than floating over it, so a
  // field it would otherwise cover stays reachable and the bar above it
  // holds still instead of being pushed off the top.
  interactiveWidget: "resizes-content",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fffdfb" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1815" },
  ],
};

// Every page sits under the one bar that floats along the bottom.
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const p = await principal();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Two things settled before the first paint, so nothing flashes:
            which look the person is in, and whether this page is framed as
            a window in the room, in which case it wears none of the chrome
            the room already has around it. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              beforePaint +
              ";try{if(window.self!==window.top)document.documentElement.dataset.framed=''}catch(e){document.documentElement.dataset.framed=''}" +
              ";if('framed' in document.documentElement.dataset)addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='k'){e.preventDefault();parent.postMessage({maslow:'command'},location.origin)}})",
          }}
        />
      </head>
      <body className="min-h-dvh px-6 pt-6 pb-28">
        <GlassFilter />
        {/* Motion honours the device's own setting: someone who asked for
            less of it gets the meaning without the travel. */}
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
        <div className="app-dev-toolbar">
          <DevToolbar />
        </div>
        <Analytics
          config={deployment.analytics}
          where={deployment.where}
          person={p && { id: p.personId, orgId: p.orgId, role: p.role }}
        />
      </body>
    </html>
  );
}
