import "./globals.css";

import type { ReactNode } from "react";

import { deployment } from "@/lib/deployment";

export const metadata = { title: "placeholder" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-auto my-12 max-w-2xl space-y-6 px-4">
        {deployment.identity.kind === "dev" && (
          <p className="text-muted-foreground border-l-2 pl-3 text-sm">
            Development sign-in is active: no identity provider is configured.
          </p>
        )}
        {children}
      </body>
    </html>
  );
}
