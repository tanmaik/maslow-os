import "./globals.css";

import type { ReactNode } from "react";

import { DevToolbar } from "@/components/dev-toolbar";

export const metadata = { title: "placeholder" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="mx-auto my-12 max-w-2xl space-y-6 px-4 pb-16">
        {children}
        <DevToolbar />
      </body>
    </html>
  );
}
