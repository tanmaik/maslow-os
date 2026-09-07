import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { principal } from "@/lib/session";

// Settings are the signed-in person's; anyone else is sent to sign in
// before the page starts.
export default async function Layout({ children }: { children: ReactNode }) {
  if (!(await principal())) redirect("/");
  return children;
}
