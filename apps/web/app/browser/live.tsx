"use client";

import {
  RiAddLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiGlobalLine,
  RiRefreshLine,
} from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { InBar } from "@/app/room/panel";
import { Button } from "@/components/base/buttons/button";
import {
  ButtonGroup,
  ButtonGroupItem,
} from "@/components/base/buttons/button-group";
import { CloseButton } from "@/components/base/buttons/close-button";
import { Divider } from "@/components/base/divider/divider";
import { InputBase } from "@/components/base/input/input";
import { PillTab, PillTabList } from "@/components/base/tabs/pill-tab";
import { liveSocket } from "@/lib/live";
import { FAST, LEAVE } from "@/lib/motion";
import { cx } from "@/utils/cx";

// The computer's browser, live and in hand: its picture as video from the
// machine itself, and the person's pointer, clicks, keys and scrolls sent
// back the instant they happen, so the page's hover states and cursor are
// theirs. The machine draws the page at the size of this pane, so the
// picture fills the window edge to edge at any size and a click lands
// where it fell on it. Until the machine says otherwise, the size it
// starts at.
const WIDTH = 1280;
const HEIGHT = 800;

// The video as the door sends it: H.264 in Annex B form, decoded by the
// browser's own decoder, which is told the size each stream begins at.
const codec = (width: number, height: number) =>
  ({
    codec: "avc1.42E01E",
    codedWidth: width,
    codedHeight: height,
    avc: { format: "annexb" },
    optimizeForLatency: true,
  }) as const;

// How long the pane waits after a drag settles before telling the
// machine its new size: long enough that a drag is one word, not fifty.
const SETTLED = 200;

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
  | { size: { w: number; h: number } }
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
  // The size the picture arrives at, as the machine says it: the canvas,
  // the decoder and where a click lands are all this size.
  const [shot, setShot] = useState({ w: WIDTH, h: HEIGHT });
  // The pane itself, measured so the machine can draw the page at it.
  const paneRef = useRef<HTMLDivElement>(null);
  // The way to tell the machine this pane's size, from wherever it is
  // needed: on every resize once it settles, and the moment a socket
  // opens, since the machine starts at a size of its own.
  const measure = useRef<() => void>(() => {});
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
  // Whether the last drag left words to carry, so the way to carry them is
  // only offered when there are any.
  const [selected, setSelected] = useState(false);

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
    // What is coming now. The machine says it as the socket opens and
    // again whenever the pane changes size, and begins a fresh stream at
    // the new size, so the decoder is never fed a frame of another shape.
    let shape = { w: WIDTH, h: HEIGHT };
    const paint = (frame: VideoFrame) => {
      canvas.current
        ?.getContext("2d")
        ?.drawImage(frame, 0, 0, shape.w, shape.h);
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
      d.configure(codec(shape.w, shape.h));
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
        measure.current();
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
          } else if ("size" in s) {
            shape = s.size;
            setShot(s.size);
            restart();
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

  // The same, waiting for what the browser answered: the selected words,
  // or why there are none to be had.
  const ask = (a: Act) => new Promise<Answer>((answer) => send(a, answer));

  // A word to the door that nothing waits on: which tab to show, a new
  // one, one to close, or where the pointer is, unnumbered so the page's
  // hover states follow it at once.
  const tell = (
    word:
      { tab: number } | { newTab: true } | { closeTab: number } | { act: Act },
  ) => {
    const ws = sock.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(word));
  };
  const moved = (to: { x: number; y: number }) => {
    pointer.current = to;
    if (framed.current) return;
    framed.current = true;
    requestAnimationFrame(() => {
      framed.current = false;
      if (pointer.current) tell({ act: { kind: "move", ...pointer.current } });
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

  // Where a pointer event fell on the picture, in the browser's own
  // pixels. The picture is the pane's size, so this is one to one while a
  // drag is still settling and the machine has not caught up yet.
  const at = (
    el: HTMLCanvasElement,
    e: { offsetX: number; offsetY: number },
  ) => {
    // The picture keeps its shape inside the element, centred, so a point
    // on the element is a point on the picture through that scale and
    // that margin, and a point in the margin is the nearest edge.
    const scale = Math.min(el.clientWidth / shot.w, el.clientHeight / shot.h);
    const left = (el.clientWidth - shot.w * scale) / 2;
    const top = (el.clientHeight - shot.h * scale) / 2;
    const inside = (n: number, max: number) =>
      Math.min(max, Math.max(0, Math.round(n)));
    return {
      x: inside((e.offsetX - left) / scale, shot.w),
      y: inside((e.offsetY - top) / scale, shot.h),
    };
  };

  // The pane's size, told to the machine once a drag has settled, so the
  // page there is drawn at the size it is shown at and the picture fills
  // the window with nothing let in around it. Even numbers, since the
  // video it becomes is made in pairs of pixels.
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    let due: ReturnType<typeof setTimeout> | undefined;
    measure.current = () => {
      const w = Math.round(el.clientWidth / 2) * 2;
      const h = Math.round(el.clientHeight / 2) * 2;
      const ws = sock.current;
      if (w < 2 || h < 2 || ws?.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ size: { w, h } }));
    };
    const watch = new ResizeObserver(() => {
      clearTimeout(due);
      due = setTimeout(() => measure.current(), SETTLED);
    });
    watch.observe(el);
    return () => {
      clearTimeout(due);
      watch.disconnect();
    };
  }, []);

  // With no page to look at, the hand belongs in the address field, which
  // is the only thing there is to do.
  useEffect(() => {
    if (state === "closed") address.current?.focus();
  }, [state]);

  // The wheel over the picture scrolls the page inside it and not this
  // one; React's own wheel listener is passive and cannot say so.
  const wheel = useCallback((el: HTMLCanvasElement | null) => {
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      send({ kind: "scroll", ...at(el, e), dy: Math.round(e.deltaY) });
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, []);

  // The page the picture is on, and whether the address says something else
  // — the only time there is anything to go to.
  const shown = tabs.find((t) => t.id === current);
  const here = shown && shown.url !== "about:blank" ? shown.url : "";
  const elsewhere = url.trim().length > 0 && url.trim() !== here;
  const ready = state === "open" && decodes;

  return (
    <div
      className={cx(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default",
        "[html[data-framed]_&]:rounded-none [html[data-framed]_&]:border-0",
      )}
    >
      {/* Where it has been, where it is, and where it is going: one row,
          in the window's own bar when there is one. */}
      <InBar
        // Where the browser is is the browser: on a phone the address
        // keeps the strip under the bar, the width of the screen.
        phone="strip"
        as={(controls) => (
          <div className="flex h-[45px] shrink-0 items-center border-b border-separator-border px-2">
            {controls}
          </div>
        )}
      >
        <form
          className="flex min-w-0 flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) send({ kind: "navigate", url: url.trim() });
          }}
        >
          <ButtonGroup size="small" aria-label="This page">
            <ButtonGroupItem
              size="small"
              iconOnly
              leadingIcon={RiArrowLeftLine}
              aria-label="Back"
              onClick={() => send({ kind: "back" })}
            />
            <ButtonGroupItem
              size="small"
              iconOnly
              leadingIcon={RiArrowRightLine}
              aria-label="Forward"
              onClick={() => send({ kind: "forward" })}
            />
            <ButtonGroupItem
              size="small"
              iconOnly
              leadingIcon={RiRefreshLine}
              aria-label="Reload"
              onClick={() => send({ kind: "reload" })}
            />
          </ButtonGroup>
          <InputBase
            ref={address}
            size="small"
            aria-label="Address"
            leadingIcon={RiGlobalLine}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="An address"
            autoComplete="off"
            spellCheck={false}
            fieldClassName="min-w-0 flex-1 focus-within:ring-border-focus-ring"
          />
          {elsewhere && (
            // One radius across the row: the group, the field and this.
            <Button
              type="submit"
              variant="secondary"
              size="small"
              className="rounded-2lg"
            >
              Go
            </Button>
          )}
        </form>
      </InBar>
      {/* The browser's tabs, one thin row under the bar: the one shown is
          raised, any can be closed, and there is always room for one more.
          Words picked on the page are carried from here, where they cannot
          be read as the address. */}
      <div className="flex h-[37px] shrink-0 items-center gap-1 overflow-x-auto border-b border-separator-border px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <PillTabList aria-label="Tabs">
          <AnimatePresence initial={false}>
            {tabs.map((t) => (
              <motion.span
                key={t.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9, transition: LEAVE }}
                transition={FAST}
                // A tab is 180 at its widest, and the pill shrinks to it:
                // the title takes what is left after the close's 28, cut
                // with an ellipsis, so the two never meet at any length.
                className="relative flex max-w-[180px] min-w-0 items-center"
              >
                <PillTab
                  variant="gray"
                  isSelected={t.id === current}
                  onSelect={() => tell({ tab: t.id })}
                  // The pill's own label box may shrink, so the title is
                  // cut rather than run under the close.
                  className="min-w-0 shrink pr-7 [&>span]:min-w-0"
                >
                  <span className="block truncate">
                    {t.title ||
                      (t.url === "about:blank" ? "" : t.url) ||
                      "New tab"}
                  </span>
                </PillTab>
                <CloseButton
                  size="xs"
                  aria-label={`Close ${t.title || "tab"}`}
                  onClick={() => tell({ closeTab: t.id })}
                  // 20 of glyph in a 24 target, carrying no fill of its own
                  // so it reads the same on the raised tab and beside it.
                  className="absolute top-1/2 right-0.5 z-20 -translate-y-1/2 bg-transparent before:absolute before:-inset-0.5 before:content-[''] hover:bg-background-tertiary-hover"
                />
              </motion.span>
            ))}
          </AnimatePresence>
        </PillTabList>
        <button
          type="button"
          aria-label="Open a new tab"
          onClick={() => tell({ newTab: true })}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-2lg text-foreground-icon-secondary transition-colors duration-fast ease-plain outline-none hover:bg-background-primary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        >
          <RiAddLine className="size-4" aria-hidden />
        </button>
        {selected && (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto shrink-0"
            onClick={copy}
          >
            Copy selection
          </Button>
        )}
      </div>
      {/* The page itself, on paper, edge to edge: the picture keeps the
          machine browser's own shape and nothing shows through behind it. */}
      <div
        ref={paneRef}
        className="relative min-h-0 flex-1 bg-background-primary-default"
      >
        {/* The canvas stays, shown or not, so the first frame has somewhere
          to land before the door has said the browser is open. */}
        <canvas
          ref={(el) => {
            canvas.current = el;
            return wheel(el);
          }}
          width={shot.w}
          height={shot.h}
          aria-label="Browser"
          tabIndex={0}
          className={cx(
            "absolute inset-0 size-full touch-none bg-background-primary-default object-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring",
            ready ? "" : "hidden",
          )}
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
              send({ kind: "select", ...start, x2: end.x, y2: end.y });
              held.current = ask({ kind: "copy" });
              setSelected(true);
            } else {
              held.current = null;
              setSelected(false);
              send({ kind: "click", ...end });
            }
          }}
          // A drag let go of somewhere else is no drag at all, and the page
          // is told the pointer has gone.
          onMouseLeave={() => {
            from.current = null;
            pointer.current = null;
            tell({ act: { kind: "leave" } });
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
            if (e.key.length === 1) send({ kind: "type", text: e.key });
            else send({ kind: "key", key: e.key });
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text");
            if (text) send({ kind: "type", text });
          }}
        />
        {/* Nothing on the page yet: the address field has the hand, and the
          one line under the glyph says what to do with it. */}
        <AnimatePresence>
          {!ready && (state === "asking" || state === "closed") && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: LEAVE }}
              transition={FAST}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background-primary-default"
            >
              <RiGlobalLine
                className="size-8 text-foreground-icon-tertiary"
                aria-hidden
              />
              <p className="text-body-medium text-text-secondary">
                {state === "asking"
                  ? "Looking for your computer's browser…"
                  : "Type an address above, or let Claude Code open one."}
              </p>
            </motion.div>
          )}
          {/* A page, or the machine, that would not answer. */}
          {!ready && (state === "failed" || !decodes) && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: LEAVE }}
              transition={FAST}
              className="absolute inset-0 overflow-y-auto bg-background-primary-default p-4"
            >
              <h2 className="text-title-3-semibold text-text-primary">
                {decodes
                  ? "Cannot reach your computer's browser"
                  : "This browser cannot show the picture"}
              </h2>
              <p className="mt-3 text-body-regular text-text-secondary">
                {decodes
                  ? "The door on your computer did not answer. Trying again every second."
                  : "The picture arrives as video, which this browser cannot decode."}
              </p>
              <Divider className="my-5" />
              <p className="text-body-medium text-text-primary">
                Please try the following:
              </p>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-body-regular text-text-secondary">
                {decodes ? (
                  <>
                    <li>Wait a moment — this page keeps asking on its own.</li>
                    <li>Computer, in Settings, says whether yours is up.</li>
                  </>
                ) : (
                  <>
                    <li>
                      Open this page in a current Chrome, Safari or Firefox.
                    </li>
                    <li>The terminal works here either way.</li>
                  </>
                )}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
        {/* What came of the last copy, over the picture and out of its way. */}
        {said && (
          <p
            role="status"
            className="absolute inset-x-0 bottom-0 bg-background-secondary-default px-3 py-2 text-caption-1-regular text-text-secondary"
          >
            {said}
          </p>
        )}
      </div>
    </div>
  );
}
