"use client";

import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// One card of settings: a place the rail points at, its name, one line on
// what it holds, and the rest. Asked for one section alone, with ?only=,
// as a block in the room is, every other section stays out of the way.
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  const only = useSearchParams().get("only");
  if (only && only !== id) return null;
  return (
    <Card
      id={id}
      className={
        only
          ? "rounded-none bg-transparent ring-0 [--card-spacing:--spacing(2)]"
          : "scroll-mt-24 rounded-[14px]"
      }
    >
      <CardHeader>
        <CardTitle className="page-title text-sm font-semibold">
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
