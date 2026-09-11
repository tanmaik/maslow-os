"use client";

import {
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { liveSocket } from "@/lib/live";

// The computer's browser, live and in hand: its picture as video from the
// machine itself, and the person's pointer, clicks, keys and scrolls sent
// back the instant they happen, so the page's hover states and cursor are
// theirs. The picture is the browser's own 1280 by 800; a click lands
// where it fell on it.
const WIDTH = 1280;
const HEIGHT = 800;

// The video as the door sends it: H.264 in Annex B form, decoded by the
// browser's own decoder.
const CODEC = {
  codec: "avc1.42E01E",
  codedWidth: WIDTH,
  codedHeight: HEIGHT,
  avc: { format: "annexb" },
  optimizeForLatency: true,
} as const;

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
  | { kind: "copy" }
  | { kind: "move"; x: number; y: number }
  | { kind: "leave" }
  | { kind: "back" }
  | { kind: "forward" }
  | { kind: "reload" };

// One tab of the machine's browser, as the door lists it.
type Tab = { id: number; title: string; url: string };

// What the door says in words on the View socket.
type Said =
  | { browser: "open" | "closed" }
  | { tabs: Tab[]; current: number | null }
  | { id: number; copy?: string; why?: string }
  | { changed: string }
  | { cursor: string }
  | { pong: number };

export function LiveBrowser() {
  const [state, setState] = useState<"asking" | "open" | "closed" | "failed">(
    "asking",
  );
  const [said, setSaid] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const address = useRef<HTMLInputElement>(null);
  // The browser's tabs and the one the picture shows.
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [decodes, setDecodes] = useState(true);
  // The page's own cursor under the pointer, worn by the person's: a hand
  // over a link, a bar over words.
  const [cursor, setCursor] = useState("default");
  const canvas = useRef<HTMLCanvasElement>(null);
  // Where the pointer is on the picture, sent once a frame while it moves.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const framed = useRef(false);
  const sock = useRef<WebSocket | null>(null);
  // Each hand is numbered, so the browser's answer finds who asked.
  const seq = useRef(0);
  const waiting = useRef(new Map<number, (answer: Answer) => void>());
  // Where a drag began on the picture, while the button is down, and what
  // came of the last drag: the words it selected, or why it could not
  // have them.
  const from = useRef<{ x: number; y: number } | null>(null);
  const held = useRef<Promise<Answer> | null>(null);

  useEffect(() => setDecodes("VideoDecoder" in window), []);

  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seen = false;

    // The picture: each unit straight into the decoder, each frame it
    // gives onto the canvas. Deltas wait for a key frame, and a decoder
    // that errs is replaced and waits for the next one.
    let decoder: VideoDecoder | null = null;
    let wantKey = true;
    let frames = 0;
    const paint = (frame: VideoFrame) => {
      canvas.current?.getContext("2d")?.drawImage(frame, 0, 0, WIDTH, HEIGHT);
      frame.close();
    };
    const restart = () => {
      try {
        decoder?.close();
      } catch {
        // Already closed by its own error.
      }
      decoder = null;
      wantKey = true;
      if (!("VideoDecoder" in window)) return;
      const d = new VideoDecoder({ output: paint, error: restart });
      d.configure(CODEC);
      decoder = d;
    };
    const feed = (buf: ArrayBuffer) => {
      if (!decoder) return;
      const bytes = new Uint8Array(buf);
      const key = bytes[0] === 1;
      if (wantKey && !key) return;
      wantKey = false;
      if (!seen) {
        seen = true;
        setState("open");
      }
      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: key ? "key" : "delta",
            timestamp: frames++ * 33333,
            data: bytes.subarray(1),
          }),
        );
      } catch {
        restart();
      }
    };

    // Video flows only while the page is in view; asking for it again
    // starts from a key frame.
    const view = () => {
      const on = !document.hidden;
      if (on) restart();
      ws?.send(JSON.stringify({ view: on }));
    };

    const connect = async () => {
      try {
        const next = await liveSocket("view");
        if (stopped) return next.close();
        ws = next;
        sock.current = next;
        seen = false;
        view();
        next.onmessage = (m) => {
          if (m.data instanceof ArrayBuffer) return feed(m.data);
          const s = JSON.parse(m.data as string) as Said;
          if ("browser" in s) {
            seen = s.browser === "open";
            setState(s.browser);
          } else if ("tabs" in s) {
            setTabs(s.tabs);
            setCurrent(s.current);
            // The address bar follows the tab shown, unless the person is
            // in the middle of typing one.
            const shown = s.tabs.find((t) => t.id === s.current);
            if (shown && document.activeElement !== address.current)
              setUrl(shown.url === "about:blank" ? "" : shown.url);
          } else if ("cursor" in s) {
            setCursor(s.cursor);
          } else if ("id" in s) {
            const answer: Answer =
              s.why === undefined
                ? { ok: true, text: s.copy ?? "" }
                : { ok: false, why: s.why };
            setSaid(answer.ok ? null : answer.why);
            waiting.current.get(s.id)?.(answer);
            waiting.current.delete(s.id);
          }
        };
        next.onclose = () => {
          ws = null;
          sock.current = null;
          if (stopped) return;
          setState("failed");
          timer = setTimeout(connect, 1000);
        };
      } catch {
        if (stopped) return;
        setState("failed");
        timer = setTimeout(connect, 5000);
      }
    };
    void connect();
    const ping = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ ping: performance.now() }));
    }, 2000);
    document.addEventListener("visibilitychange", view);

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(ping);
      document.removeEventListener("visibilitychange", view);
      ws?.close();
      sock.current = null;
      try {
        decoder?.close();
      } catch {
        // Already closed.
      }
    };
  }, []);

  // A hand on the browser, sent the instant it happens.
  const send = (a: Act, answer?: (answer: Answer) => void) => {
    const ws = sock.current;
    if (ws?.readyState !== WebSocket.OPEN)
      return answer?.({ ok: false, why: "Your computer is not connected." });
    const id = ++seq.current;
    if (answer) waiting.current.set(id, answer);
    ws.send(JSON.stringify({ act: a, id }));
  };
  const act = (a: Act) => send(a);

  // The same, waiting for what the browser answered: the selected words,
  // or why there are none to be had.
  const ask = (a: Act) => new Promise<Answer>((answer) => send(a, answer));

  // A word to the door that is not a hand on the page: which tab to show,
  // a new one, or one to close.
  const tell = (
    word: { tab: number } | { newTab: true } | { closeTab: number },
  ) => {
    const ws = sock.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(word));
  };

  // The pointer's whereabouts, unnumbered and unanswered: nothing waits on
  // them, and where they go the page's hover states follow.
  const point = (a: Act) => {
    const ws = sock.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ act: a }));
  };
  const moved = (to: { x: number; y: number }) => {
    pointer.current = to;
    if (framed.current) return;
    framed.current = true;
    requestAnimationFrame(() => {
      framed.current = false;
      if (pointer.current) point({ kind: "move", ...pointer.current });
    });
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
    el: HTMLCanvasElement,
    e: { offsetX: number; offsetY: number },
  ) => {
    // The picture keeps its shape inside the element, centred, so a point
    // on the element is a point on the picture through that scale and
    // that margin, and a point in the margin is the nearest edge.
    const scale = Math.min(el.clientWidth / WIDTH, el.clientHeight / HEIGHT);
    const left = (el.clientWidth - WIDTH * scale) / 2;
    const top = (el.clientHeight - HEIGHT * scale) / 2;
    const inside = (n: number, max: number) =>
      Math.min(max, Math.max(0, Math.round(n)));
    return {
      x: inside((e.offsetX - left) / scale, WIDTH),
      y: inside((e.offsetY - top) / scale, HEIGHT),
    };
  };

  // The wheel over the picture scrolls the page inside it and not this
  // one; React's own wheel listener is passive and cannot say so.
  const wheel = useCallback((el: HTMLCanvasElement | null) => {
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      act({ kind: "scroll", ...at(el, e), dy: Math.round(e.deltaY) });
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* The browser's tabs: the one shown is raised, any can be closed,
          and there is always room for one more. */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`flex max-w-56 shrink-0 items-center rounded-md ${t.id === current ? "bg-accent" : ""}`}
          >
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 flex-1 justify-start font-normal"
              aria-current={t.id === current ? "true" : undefined}
              onClick={() => tell({ tab: t.id })}
            >
              <span className="truncate">
                {t.title || (t.url === "about:blank" ? "" : t.url) || "New tab"}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Close ${t.title || "tab"}`}
              onClick={() => tell({ closeTab: t.id })}
            >
              <XMarkIcon />
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New tab"
          onClick={() => tell({ newTab: true })}
        >
          <PlusIcon />
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) act({ kind: "navigate", url: url.trim() });
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={() => act({ kind: "back" })}
        >
          <ArrowLeftIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Forward"
          onClick={() => act({ kind: "forward" })}
        >
          <ArrowRightIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Reload"
          onClick={() => act({ kind: "reload" })}
        >
          <ArrowPathIcon />
        </Button>
        <Input
          ref={address}
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
      {/* The canvas stays, shown or not, so the first frame has somewhere
          to land before the door has said the browser is open. */}
      <canvas
        ref={(el) => {
          canvas.current = el;
          return wheel(el);
        }}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Your computer's browser"
        tabIndex={0}
        className={`bg-muted min-h-0 w-full flex-1 touch-none border object-contain outline-none focus:ring-2 ${state === "open" && decodes ? "" : "hidden"}`}
        style={{ cursor }}
        onMouseMove={(e) => moved(at(e.currentTarget, e.nativeEvent))}
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
        // A drag let go of somewhere else is no drag at all, and the page
        // is told the pointer has gone.
        onMouseLeave={() => {
          from.current = null;
          pointer.current = null;
          point({ kind: "leave" });
          setCursor("default");
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
      {(state !== "open" || !decodes) && (
        <div className="bg-muted text-muted-foreground flex min-h-0 w-full flex-1 items-center justify-center border text-sm">
          {!decodes
            ? "This browser cannot decode video here; a current Chrome, Safari or Firefox can."
            : state === "closed"
              ? "Closed. Go to an address above, or wait for Claude Code to open it."
              : state === "failed"
                ? "Could not reach your computer's browser. Trying again."
                : "Looking…"}
        </div>
      )}
      {said && <p className="text-muted-foreground text-sm">{said}</p>}
    </div>
  );
}
