"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The computer's browser, live and in hand: a picture every moment, and
// the person's clicks, keys and scrolls passed back to it. The picture is
// the browser's own 1280 by 800; a click lands where it fell on it.
const WIDTH = 1280;
const HEIGHT = 800;

type Act =
  | { kind: "navigate"; url: string }
  | { kind: "click"; x: number; y: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }
  | { kind: "scroll"; x: number; y: number; dy: number };

export function LiveBrowser() {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<"asking" | "open" | "closed" | "failed">(
    "asking",
  );
  const [said, setSaid] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const busy = useRef(false);
  // Hands wait their turn and go one at a time, in the order they were
  // made; letters typed while one is on its way go together in the next.
  const waiting = useRef<Act[]>([]);

  // The picture, again and again, faster while a hand is on it.
  useEffect(() => {
    let stopped = false;
    let last: string | null = null;
    const ask = async () => {
      if (!busy.current)
        try {
          const res = await fetch("/computer/browser", { cache: "no-store" });
          if (stopped) return;
          if (res.status === 204) setState("closed");
          else if (!res.ok) setState("failed");
          else {
            const next = URL.createObjectURL(await res.blob());
            if (last) URL.revokeObjectURL(last);
            last = next;
            setSrc(next);
            setState("open");
          }
        } catch {
          if (!stopped) setState("failed");
        }
      if (!stopped) setTimeout(ask, 700);
    };
    void ask();
    return () => {
      stopped = true;
      if (last) URL.revokeObjectURL(last);
    };
  }, []);

  const act = (a: Act) => {
    const last = waiting.current.at(-1);
    if (a.kind === "type" && last?.kind === "type") last.text += a.text;
    else waiting.current.push(a);
    if (!busy.current) void send();
  };

  const send = async () => {
    busy.current = true;
    for (
      let next = waiting.current.shift();
      next;
      next = waiting.current.shift()
    )
      try {
        const res = await fetch("/computer/browser/act", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        });
        setSaid(res.ok ? null : await res.text());
      } catch (err) {
        setSaid((err as Error).message);
      }
    busy.current = false;
  };

  // Where a pointer event fell on the picture, in the browser's own pixels.
  const at = (
    el: HTMLImageElement,
    e: { offsetX: number; offsetY: number },
  ) => ({
    x: Math.round((e.offsetX / el.clientWidth) * WIDTH),
    y: Math.round((e.offsetY / el.clientHeight) * HEIGHT),
  });

  // The wheel over the picture scrolls the page inside it and not this
  // one; React's own wheel listener is passive and cannot say so.
  const wheel = useCallback((el: HTMLImageElement | null) => {
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      act({ kind: "scroll", ...at(el, e), dy: Math.round(e.deltaY) });
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);

  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) act({ kind: "navigate", url: url.trim() });
        }}
      >
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="An address to go to"
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" variant="outline">
          Go
        </Button>
      </form>
      {state === "open" && src ? (
        <img
          ref={wheel}
          src={src}
          alt="Your computer's browser"
          tabIndex={0}
          className="w-full cursor-crosshair rounded-md border outline-none focus:ring-2"
          onClick={(e) =>
            act({ kind: "click", ...at(e.currentTarget, e.nativeEvent) })
          }
          // A chord with Cmd or Ctrl stays the person's own browser's:
          // reload, a new tab, the address bar. Paste is the one that
          // means something here, and it goes as its text.
          onKeyDown={(e) => {
            if (e.metaKey || e.ctrlKey) return;
            e.preventDefault();
            if (e.key.length === 1) act({ kind: "type", text: e.key });
            else act({ kind: "key", key: e.key });
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text");
            if (text) act({ kind: "type", text });
          }}
        />
      ) : (
        <div className="bg-muted text-muted-foreground flex aspect-[16/10] w-full items-center justify-center rounded-md border text-sm">
          {state === "closed"
            ? "Closed. Go to an address above, or wait for Claude Code to open it."
            : state === "failed"
              ? "Could not reach your computer's browser. Trying again."
              : "Looking…"}
        </div>
      )}
      <p className="text-muted-foreground text-sm">
        {said ??
          "Click the picture to click there; with it focused, what you type goes to the page. Claude Code sees the same browser."}
      </p>
    </div>
  );
}
