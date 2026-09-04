import "./globals.css";

import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { DevToolbar } from "@/components/dev-toolbar";

export const metadata = { title: "placeholder" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh px-4 py-6 pb-16 sm:px-6 lg:px-8">
        <AppHeader />
        {children}
        <DevToolbar />
      </body>
    </html>
  );
}
