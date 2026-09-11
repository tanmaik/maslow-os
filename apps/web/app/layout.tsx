import "@fontsource-variable/inter";
import "./globals.css";

import { Suspense, type ReactNode } from "react";

import { Analytics } from "@/components/analytics";
import { Chrome } from "@/components/chrome";
import { DevToolbar } from "@/components/dev-toolbar";
import { beforePaint } from "@/components/look";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

// On a phone Maslow is an app of its own: added to the home screen it
// opens without the browser's chrome, edge to edge.
export const metadata = {
  title: "Maslow",
  appleWebApp: { capable: true, title: "Maslow", statusBarStyle: "default" },
};
export const viewport = { viewportFit: "cover" };

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
              ";try{if(window.self!==window.top)document.documentElement.dataset.framed=''}catch(e){document.documentElement.dataset.framed=''}",
          }}
        />
      </head>
      <body className="min-h-dvh px-6 pt-6 pb-28">
        <Suspense fallback={null}>
          <Chrome />
        </Suspense>
        {children}
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
