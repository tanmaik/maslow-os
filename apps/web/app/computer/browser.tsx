"use client";

import { useEffect, useState } from "react";

// A live picture of the computer's browser, the one Claude Code drives:
// asked for every few seconds, shown while it is open, and said to be
// closed otherwise.
export function BrowserView() {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"asking" | "open" | "closed" | "failed">(
    "asking",
  );
  useEffect(() => {
    let stopped = false;
    let last: string | null = null;
    const ask = async () => {
      try {
        const res = await fetch("/computer/browser", { cache: "no-store" });
        if (stopped) return;
        if (res.status === 204) {
          setState("closed");
        } else if (!res.ok) {
          setState("failed");
        } else {
          const url = URL.createObjectURL(await res.blob());
          if (last) URL.revokeObjectURL(last);
          last = url;
          setSrc(url);
          setState("open");
        }
      } catch {
        if (!stopped) setState("failed");
      }
      if (!stopped) setTimeout(ask, 3000);
    };
    void ask();
    return () => {
      stopped = true;
      if (last) URL.revokeObjectURL(last);
    };
  }, []);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Claude Code&apos;s browser</p>
      {state === "open" && src ? (
        <img
          src={src}
          alt="What the computer's browser is looking at"
          className="w-full rounded-md border"
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          {state === "closed"
            ? "Closed. It opens when Claude Code uses it, and this shows what it sees."
            : state === "failed"
              ? "Could not reach it. Trying again."
              : "Looking…"}
        </p>
      )}
    </div>
  );
}
