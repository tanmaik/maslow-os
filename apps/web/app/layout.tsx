import "@fontsource-variable/instrument-sans";
import "@fontsource/instrument-serif";
import "@fontsource/instrument-serif/400-italic.css";
import "./globals.css";

import { Suspense, type ReactNode } from "react";

import { Analytics } from "@/components/analytics";
import { Chrome } from "@/components/chrome";
import { DevToolbar } from "@/components/dev-toolbar";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

export const metadata = { title: "Maslow" };

// The canvas is the screen: the chrome floats over it, and every page sits
// under the chrome.
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const p = await principal();
  return (
    <html lang="en">
      <body className="min-h-dvh px-6 pb-24">
        <Suspense fallback={p && <div className="h-22" />}>
          <Chrome />
        </Suspense>
        {children}
        <DevToolbar />
        <Analytics
          config={deployment.analytics}
          where={deployment.where}
          person={p && { id: p.personId, orgId: p.orgId, role: p.role }}
        />
      </body>
    </html>
  );
}
