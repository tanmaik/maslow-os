"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The computer's browser, live and in hand: a picture every moment, and
// the person's clicks, keys and scrolls passed back to it. The picture is
// the browser's own 1280 by 800; a click lands where it fell on it.
const WIDTH = 1280;
const HEIGHT = 800;

// What the browser answered a hand: the selected words for a copy and
// nothing for the rest, or why it could not.
type Answer = { ok: true; text: string } | { ok: false; why: string };

type Act =
  | { kind: "navigate"; url: string }
  | { kind: "click"; x: number; y: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }
  | { kind: "scroll"; x: number; y: number; dy: number }
  | { kind: "select"; x: number; y: number; x2: number; y2: number }
  | { kind: "copy" };

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
  const waiting = useRef<{ act: Act; said?: (answer: Answer) => void }[]>([]);
  // Where a drag began on the picture, while the button is down, and what
  // came of the last drag: the words it selected, or why it could not
  // have them.
  const from = useRef<{ x: number; y: number } | null>(null);
  const held = useRef<Promise<Answer> | null>(null);

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
    const last = waiting.current.at(-1)?.act;
    if (a.kind === "type" && last?.kind === "type") last.text += a.text;
    else waiting.current.push({ act: a });
    if (!busy.current) void send();
  };

  // The same, waiting for what the browser answered: the selected words,
  // or why there are none to be had.
  const ask = (a: Act) =>
    new Promise<Answer>((said) => {
      waiting.current.push({ act: a, said });
      if (!busy.current) void send();
    });

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
          body: JSON.stringify(next.act),
        });
        const answer = res.status === 204 ? "" : await res.text();
        setSaid(res.ok ? null : answer);
        next.said?.(
          res.ok
            ? { ok: true, text: answer }
            : {
                ok: false,
                why: answer || `Your computer answered ${res.status}.`,
              },
        );
      } catch (err) {
        setSaid((err as Error).message);
        next.said?.({ ok: false, why: (err as Error).message });
      }
    busy.current = false;
  };

  // What to say of words that were, or were not, taken.
  const told = (words: string, kept = false) =>
    !words
      ? "Nothing is selected. Drag across the words."
      : kept
        ? `Your browser kept the clipboard. The words: ${words}`
        : `Copied ${words.length} character${words.length === 1 ? "" : "s"}.`;

  // The words the last drag selected, into the person's own clipboard.
  // They are asked for as the drag ends and the clipboard is handed the
  // promise of them, so a copy pressed while they are still on their way
  // takes them all the same: a browser only takes the clipboard while a
  // gesture is fresh, and it keeps one across a promise. Where it
  // refuses, the words are shown instead, to be taken by hand.
  const copy = () => {
    const answer = held.current;
    if (!answer) return setSaid(told(""));
    const words = answer.then((a) => (a.ok ? a.text : ""));
    const put =
      typeof ClipboardItem === "undefined"
        ? words.then((t) => navigator.clipboard.writeText(t))
        : navigator.clipboard.write([
            new ClipboardItem({
              "text/plain": words.then(
                (t) => new Blob([t], { type: "text/plain" }),
              ),
            }),
          ]);
    void put.then(
      () => void words.then((t) => setSaid(told(t))),
      () => void answer.then((a) => setSaid(a.ok ? told(a.text, true) : a.why)),
    );
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
        <Button type="button" variant="outline" onClick={copy}>
          Copy
        </Button>
      </form>
      {state === "open" && src ? (
        <img
          ref={wheel}
          src={src}
          alt="Your computer's browser"
          tabIndex={0}
          className="w-full cursor-crosshair rounded-md border outline-none focus:ring-2"
          // A press and a release in one place is a click; dragging
          // between them selects the words in between, as on any page.
          onMouseDown={(e) => {
            // The right and middle buttons stay the person's own, so
            // their browser's menu opens over the picture as anywhere.
            if (e.button !== 0) return;
            // Refusing the press keeps the picture from being dragged as
            // an image, so the focus it would have taken is given here,
            // without the page jumping to put it in view.
            e.preventDefault();
            e.currentTarget.focus({ preventScroll: true });
            from.current = at(e.currentTarget, e.nativeEvent);
          }}
          onMouseUp={(e) => {
            const start = from.current;
            from.current = null;
            if (!start) return;
            const end = at(e.currentTarget, e.nativeEvent);
            const moved =
              Math.abs(end.x - start.x) > 4 || Math.abs(end.y - start.y) > 4;
            if (moved) {
              act({ kind: "select", ...start, x2: end.x, y2: end.y });
              held.current = ask({ kind: "copy" });
            } else {
              held.current = null;
              act({ kind: "click", ...end });
            }
          }}
          // A drag let go of somewhere else is no drag at all.
          onMouseLeave={() => {
            from.current = null;
          }}
          // A chord with Cmd or Ctrl stays the person's own browser's:
          // reload, a new tab, the address bar. Copy and paste are the two
          // that mean something here, and they carry the words themselves.
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "c") {
              e.preventDefault();
              copy();
              return;
            }
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
          "Click the picture to click there, drag to select, and Copy takes the selected words. With it focused, what you type goes to the page. Claude Code sees the same browser."}
      </p>
    </div>
  );
}
