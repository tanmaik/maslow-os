"use client";

import { format } from "date-fns";
import { useEffect, useState } from "react";

// An instant in the reader's own time zone: 4 Sep 2026, 16:41. The server
// writes it in UTC, and the browser rewrites it in its zone as soon as it
// runs.
export function LocalTime({
  at,
  fallback = "",
}: {
  at: Date | string | null;
  fallback?: string;
}) {
  const date = at ? new Date(at) : null;
  const utc = date
    ? date.toISOString().slice(0, 16).replace("T", " ")
    : fallback;
  const [text, setText] = useState(utc);
  useEffect(() => {
    if (date) setText(format(date, "d MMM yyyy, HH:mm"));
  }, [date?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!date) return <>{fallback}</>;
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {text}
    </time>
  );
}
