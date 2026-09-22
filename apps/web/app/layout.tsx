import "./globals.css";

import { MotionConfig } from "motion/react";
import { headers } from "next/headers";
import { type ReactNode } from "react";

import { Analytics } from "@/components/analytics";
import { DevToolbar } from "@/components/dev-toolbar";
import { GlassFilter } from "@/components/glass";
import { Shell } from "@/components/shell/shell";
import { beforePaint } from "@/components/look";
import { deployment } from "@/lib/deployment";
import { membershipsByEmail } from "@maslow/db/auth";
import { orgOf } from "@maslow/db/settings";
import { principal } from "@/lib/session";
import { storage } from "@/lib/storage";

// On a phone Maslow is an app of its own: added to the home screen it
// opens without the browser's chrome, edge to edge.
export const metadata = {
  title: "Maslow",
  // The status bar is the app's own, so the desktop reaches the top of the
  // screen rather than stopping under a bar of the browser's colour.
  appleWebApp: {
    capable: true,
    title: "Maslow",
    statusBarStyle: "default",
    // What the phone shows while the app opens, one per screen size: the
    // desktop's dark ground with the icon on it, never a white page.
    startupImage: [
      {
        url: "/splash/1320x2868.png",
        media:
          "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/1206x2622.png",
        media:
          "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/1290x2796.png",
        media:
          "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/1179x2556.png",
        media:
          "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/1284x2778.png",
        media:
          "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/1170x2532.png",
        media:
          "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/1125x2436.png",
        media:
          "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)",
      },
      {
        url: "/splash/828x1792.png",
        media:
          "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
      {
        url: "/splash/750x1334.png",
        media:
          "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)",
      },
    ],
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
  themeColor: "#1c1815",
};

async function youOf(p: NonNullable<Awaited<ReturnType<typeof principal>>>) {
  const [{ org, members }, memberships] = await Promise.all([
    orgOf(p),
    membershipsByEmail(p.email),
  ]);
  const me = members.find((m) => m.id === p.userId);
  if (!me) return null;
  return {
    name: me.name,
    email: me.email,
    org: org.name,
    picture: me.avatarKey ? storage.url(me.avatarKey) : null,
    others: memberships
      .filter((m) => m.userId !== p.userId)
      .map((m) => ({ userId: m.userId, orgName: m.orgName })),
  };
}

// Every page sits under the shell, or bare where the shell does not stand.
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const p = await principal();
  // A page asked for as a frame is a pane of the shell already on screen,
  // so it is drawn bare.
  const framed = (await headers()).get("sec-fetch-dest") === "iframe";
  // Who is signed in, for the shell's account menu: their name and face,
  // and the other orgs they could be in instead.
  const you = p && !framed ? await youOf(p) : null;
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
              ";try{if(window.self!==window.top||/^\\/(home|brain|settings|computer|browser)(\\/|$)/.test(location.pathname))document.documentElement.dataset.framed=''}catch(e){document.documentElement.dataset.framed=''}" +
              ";if('framed' in document.documentElement.dataset)addEventListener('keydown',function(e){if((e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='k'){e.preventDefault();parent.postMessage({maslow:'command'},location.origin)}})",
          }}
        />
      </head>
      <body className="min-h-dvh px-6 pt-6 pb-28">
        <GlassFilter />
        {/* Motion honours the device's own setting: someone who asked for
            less of it gets the meaning without the travel. */}
        <MotionConfig reducedMotion="user">
          <Shell
            computers={!!p && deployment.computers.kind !== "none"}
            framed={framed}
            you={you}
          >
            {children}
          </Shell>
        </MotionConfig>
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
