import "./globals.css";

import type { ReactNode } from "react";

import { Analytics } from "@/components/analytics";
import { AppHeader } from "@/components/app-header";
import { DevToolbar } from "@/components/dev-toolbar";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

export const metadata = { title: "placeholder" };

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const p = await principal();
  return (
    <html lang="en">
      <body className="min-h-dvh px-4 py-6 pb-16 sm:px-6 lg:px-8">
        <AppHeader />
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
