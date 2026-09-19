"use client";

import "@xterm/xterm/css/xterm.css";

import {
  RiAddLine,
  RiCheckLine,
  RiFileCopyLine,
  RiLayoutColumnLine,
  RiLayoutRowLine,
  RiSideBarLine,
  RiTerminalBoxLine,
} from "@remixicon/react";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as Xterm } from "@xterm/xterm";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { BarButton, InBar, useFolded } from "@/app/desktop/panel";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { IconButton } from "@/components/base/buttons/icon-button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { liveSocket } from "@/lib/live";
import { FAST, LEAVE } from "@/lib/motion";
import { cx } from "@/utils/cx";
import { usePhone } from "@/hooks/use-phone";

// The keys a phone's keyboard lacks, as the terminal would send them.
const KEYS: { label: string; send: string; title?: string }[] = [
  { label: "Esc", send: "\x1b", title: "Escape" },
  { label: "Tab", send: "\t" },
  { label: "Ctrl", send: "", title: "Control, for the next letter" },
  { label: "↑", send: "\x1b[A", title: "Up" },
  { label: "↓", send: "\x1b[B", title: "Down" },
  { label: "←", send: "\x1b[D", title: "Left" },
  { label: "→", send: "\x1b[C", title: "Right" },
  { label: "-", send: "-" },
  { label: "/", send: "/" },
  { label: "|", send: "|" },
  { label: "~", send: "~" },
  { label: "Paste", send: "" },
];

// The biggest picture the machine will hold, as its door has it.
const BIGGEST = 24 * 1024 * 1024;

// One tmux window of the session: its number, its name, which tmux takes
// from what is running in it, and whether this terminal is looking at it.
type Window = { index: number; name: string; on: boolean };

// What a Mac's keys send down the socket. Splitting, moving between panes
// and opening another terminal are tmux's own: its key, ^B, then a letter.
// Command with T, W, N or Q never reaches a page, so another terminal is
// Command and Return. Nothing here closes anything: `exit` ends a pane as
// it ends any shell.
const PREFIX = "\x02";
const PRESSED: Record<string, string> = {
  Backspace: "\x15", // clear the line
  ArrowLeft: "\x01", // to its start
  ArrowRight: "\x05", // to its end
  d: `${PREFIX}%`, // a pane beside this one
  D: `${PREFIX}"`, // a pane below this one
  Enter: `${PREFIX}c`, // another terminal
  "[": `${PREFIX}p`, // the terminal before
  "]": `${PREFIX}n`, // the one after
  "{": `${PREFIX}p`,
  "}": `${PREFIX}n`,
};
// Command, Option and an arrow moves between panes.
const PANES: Record<string, string> = {
  ArrowLeft: `${PREFIX}\x1b[D`,
  ArrowRight: `${PREFIX}\x1b[C`,
  ArrowUp: `${PREFIX}\x1b[A`,
  ArrowDown: `${PREFIX}\x1b[B`,
};

// The device's own monospace, as the rest of the page is the device's own face.
const FONT = "ui-monospace, monospace";

// The terminal's colours, read from the product's theme as it is on the
// screen, so the terminal is in the same look as the page around it. Each
// is painted once and read back as plain six-digit hex, the one form every
// layer of the terminal takes: the glyph painter, the scrollbar's track and
// the ground the WebGL renderer clears to.
function theme() {
  const at = getComputedStyle(document.documentElement);
  const ctx = document.createElement("canvas").getContext("2d")!;
  const v = (name: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = at.getPropertyValue(name).trim();
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((n) => n!.toString(16).padStart(2, "0")).join("")}`;
  };
  return {
    background: v("--color-background-primary-default"),
    foreground: v("--color-text-primary"),
    cursor: v("--color-text-primary"),
    cursorAccent: v("--color-background-primary-default"),
    selectionBackground: v("--color-border-focus-ring"),
  };
}

// What this page sends down the socket, as bytes.
const encoder = new TextEncoder();

// How big a picture is, said the way a person says it.
const tooBig = (bytes: number) =>
  `That picture is ${Math.round(bytes / 1024 / 1024)}MB, and ${Math.round(BIGGEST / 1024 / 1024)}MB is the most that can be pasted.`;

// The machine's clipboard holds a PNG and nothing else, so a picture that
// arrives as anything else is drawn into one first.
async function asPng(file: File): Promise<Blob | null> {
  if (file.type === "image/png") return file;
  const image = await createImageBitmap(file).catch(() => null);
  if (!image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")?.drawImage(image, 0, 0);
  image.close();
  return new Promise((done) => canvas.toBlob(done, "image/png"));
}

// A sign-in that will come back to a port on the machine, not on this
// device: the address says so, and a browser here cannot reach it. The
// page that fails carries the code in its own address, which the terminal
// takes when it is pasted back.
// A sign-in whose answer would come back to the machine, on a port of
// its own, is no use opened on this device: the answer would land on a
// page this browser cannot load. Claude Code offers the same sign-in in
// a second form that ends in a code to paste, and that is the one this
// device is given; anything else is passed through as it came.
function forThisDevice(address: string): string {
  try {
    const url = new URL(address);
    const back = url.searchParams.get("redirect_uri");
    if (
      url.pathname === "/oauth/authorize" &&
      back !== null &&
      back.startsWith("http://localhost:")
    ) {
      url.searchParams.set("code", "true");
      url.searchParams.set(
        "redirect_uri",
        "https://platform.claude.com/oauth/code/callback",
      );
    }
    return url.toString();
  } catch {
    return address;
  }
}

// Whether a sign-in ends in a code the person carries back by hand.
function endsInACode(address: string): boolean {
  try {
    return new URL(address).searchParams.get("code") === "true";
  } catch {
    return false;
  }
}

// The person's terminal, live: what they type goes to the machine as they
// type it, what the machine draws is drawn here, and the size follows the
// window. It is one tmux session on the machine, so closing this kills
// nothing and opening it again finds it as it was. An address printed in
// it is a link, and one the machine asks to open is offered above it;
// either opens on this device, with the person's own logins.
// Where the device keeps whether the shells list is shown.
const RAIL = "terminal-rail";

// Where the device keeps which shell this terminal was turned to. Its
// socket joins the session afresh every time, landing on whatever window
// another way in left in view, so the one the person was working in is
// remembered here and turned back to.
const ON = (id?: string) => `terminal-window:${id ?? "one"}`;

// The way out of the terminal for a hand that has no mouse: the shell takes
// every key, Tab included, so Escape and then Tab is the one chord this page
// keeps for itself. Said on the page, and to a screen reader, beside the
// terminal it applies to.
const LEAVING = "terminal-leaving";
const ESCAPE = "Press Escape then Tab to leave the terminal.";

// tmux names a window after what runs in it; its own housekeeping window
// has a name in brackets that means nothing to a person.
const shellName = (name: string) => (name.startsWith("[") ? "shell" : name);

export function Terminal({
  fresh = false,
  id,
}: {
  fresh?: boolean;
  // This window on the desktop, so two terminals each remember their own
  // shell.
  id?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Whether this window was just opened from the dock, and so asks the
  // machine for a shell of its own rather than the one already showing.
  const opening = useRef(fresh);
  // The shell to turn back to as soon as the machine lists them.
  const back = useRef<number | null>(null);
  const term = useRef<Xterm | null>(null);
  // A phone's keyboard has no control key: the strip's Ctrl arms the next
  // letter typed, which goes as the control code.
  const folded = useFolded();
  const [ctrl, setCtrl] = useState(false);
  const armed = useRef(false);
  const [away, setAway] = useState<string | null>("Connecting…");
  const [offered, setOffered] = useState<string | null>(null);
  // Whether the offered address was just copied, shown on its mark.
  const [copied, setCopied] = useState(false);
  // Words the machine copied that this device's browser would not take.
  const [kept, setKept] = useState<string | null>(null);
  // Why something a person tried did not happen.
  const [refused, setRefused] = useState<string | null>(null);
  // The session's windows, as the machine lists them, and the way to turn
  // to one or open another.
  const [windows, setWindows] = useState<Window[]>([]);
  // The shell whose name is being typed, and the name so far: a
  // double-click on a name opens it, Enter keeps it, Escape leaves it.
  const [naming, setNaming] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const name = (w: Window) => {
    setDraft(shellName(w.name));
    setNaming(w.index);
  };
  // The shell just picked, marked before the machine has answered, so the
  // rail turns under the hand rather than a round trip later. The machine's
  // own list takes over the moment it agrees, and in any case two seconds on.
  const [picked, setPicked] = useState<number | null>(null);
  const picking = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pick = (index: number) => {
    setPicked(index);
    clearTimeout(picking.current);
    picking.current = setTimeout(() => setPicked(null), 2000);
    say({ select: index });
    // The shell is where the typing goes: picking one leaves the hand in it.
    term.current?.focus();
  };
  // Whether the shells list is shown, as the person last left it. On a
  // phone the list has nowhere to sit beside the terminal, so it opens as
  // a sheet instead of a rail, and starts closed rather than remembered.
  const [rail, setRail] = useState(true);
  const [sheet, setSheet] = useState(false);
  const wide = !usePhone();
  // The control a hand leaving the terminal lands on.
  const leave = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setRail(localStorage.getItem(RAIL) !== "hidden");
  }, []);
  const toggleRail = () => {
    if (!wide) return setSheet((on) => !on);
    setRail((on) => {
      localStorage.setItem(RAIL, on ? "hidden" : "shown");
      return !on;
    });
  };
  const shown = wide ? rail : sheet;
  const socket = useRef<WebSocket | null>(null);
  const say = (said: object) => socket.current?.send(JSON.stringify(said));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The way to reconnect, for the app coming back from the background:
    // a phone suspends the page and cuts the line without a word.
    let wake: (() => void) | null = null;
    const resume = () => {
      if (document.hidden || stopped) return;
      if (socket.current?.readyState === WebSocket.OPEN) return;
      clearTimeout(timer);
      wake?.();
    };
    document.addEventListener("visibilitychange", resume);
    let undo = () => {};

    const start = async () => {
      // The face is measured once it is here, so the cells are its size.
      await document.fonts.load(`13px ${FONT}`).catch(() => {});
      if (stopped) return;
      const t = new Xterm({
        fontFamily: FONT,
        fontSize: 13,
        cursorBlink: true,
        theme: theme(),
        // Option is Meta, so Option-Backspace and Option-arrow move and
        // delete by word, as they do in a terminal on the desktop.
        macOptionIsMeta: true,
      });
      term.current = t;
      const fit = new FitAddon();
      t.loadAddon(fit);
      t.loadAddon(new WebLinksAddon());
      t.open(el);
      // Every layer the terminal paints takes its colours once it is on the
      // page: the ground it clears to is not read from the options it was
      // made with.
      t.options.theme = theme();
      t.textarea?.setAttribute("aria-describedby", LEAVING);
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        t.loadAddon(webgl);
      } catch {
        // The default renderer stands in where WebGL is not to be had.
      }
      fit.fit();
      t.focus();

      const sized = new ResizeObserver(() => fit.fit());
      sized.observe(el);
      const look = new MutationObserver(() => {
        t.options.theme = theme();
      });
      look.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });

      // What runs on the machine may ask what colour the ground is, as
      // Claude Code does to pick its own look; the answer is the theme's
      // background, so a light terminal is not taken for a dark one.
      t.parser.registerOscHandler(11, (ask) => {
        if (ask !== "?") return false;
        const hex = theme().background;
        const c = (i: number) => `${hex.slice(i, i + 2)}${hex.slice(i, i + 2)}`;
        socket.current?.send(
          encoder.encode(`\x1b]11;rgb:${c(1)}/${c(3)}/${c(5)}\x1b\\`),
        );
        return true;
      });
      // Words picked on the machine land on this device's clipboard: the
      // machine asks with OSC 52, the code and then the words in base64.
      t.parser.registerOscHandler(52, (ask) => {
        const b64 = ask.slice(ask.indexOf(";") + 1);
        if (!b64 || b64 === "?") return true;
        let words: string;
        try {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          words = new TextDecoder().decode(bytes);
        } catch {
          return true; // Nothing legible was offered.
        }
        // A browser that refuses the clipboard, however it refuses, gets
        // the words shown instead, to be taken by hand.
        const put = navigator.clipboard?.writeText(words);
        if (!put) setKept(words);
        else
          void put.then(
            () => setKept(null),
            () => setKept(words),
          );
        return true;
      });

      // The keys a Mac's own terminal answers to, which a browser has no
      // opinion about: Command and Backspace clears the line, Command and
      // an arrow goes to its start or its end. Everything else, Command-V
      // included, is left to the browser and to xterm.
      // A shell answers to Tab, so a hand with no mouse would be held here
      // for good. Escape, which a shell takes as its own and is none the
      // worse for, and then Tab, is the way out: the list of shells and the
      // bar's controls are a Tab away from there.
      let escaped = false;
      t.attachCustomKeyEventHandler((e) => {
        if (e.type === "keydown" && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (e.key === "Tab" && escaped) {
            escaped = false;
            e.preventDefault();
            leave.current?.focus();
            return false;
          }
          escaped = e.key === "Escape";
        }
        if (e.type !== "keydown" || !e.metaKey || e.ctrlKey) return true;
        // Command-K is the room's, here as everywhere: the command bar.
        if (e.key === "k" && !e.altKey && !e.shiftKey) {
          e.preventDefault();
          window.postMessage({ maslow: "command" }, location.origin);
          return false;
        }
        // With Command held, a Mac reports the letter without its Shift;
        // Shift is read on its own so Command-Shift-D is not Command-D.
        const key =
          e.shiftKey && e.key.length === 1 ? e.key.toUpperCase() : e.key;
        const code = (e.altKey ? PANES : PRESSED)[key];
        if (!code) return true;
        e.preventDefault();
        socket.current?.send(encoder.encode(code));
        return false;
      });

      // A picture pasted from this device: the terminal itself can only
      // carry text, so the picture goes to the machine's clipboard, where
      // what runs in the terminal can ask for it, and the key that asks
      // is pressed on the person's behalf. Claude Code wants Control-V
      // for a picture, whatever the device's own paste key is.
      const pasted = (e: ClipboardEvent) => {
        const picture = [...(e.clipboardData?.items ?? [])].find(
          (i) => i.kind === "file" && i.type.startsWith("image/"),
        );
        if (!picture) return;
        const file = picture.getAsFile();
        const to = socket.current;
        if (!file || !to) return;
        e.preventDefault();
        e.stopPropagation();
        // More than the machine will hold is refused here, where it can be
        // said.
        if (file.size > BIGGEST) {
          setRefused(tooBig(file.size));
          return;
        }
        void asPng(file).then(async (png) => {
          if (!png) return setRefused("That picture could not be read.");
          // Drawing it again can make it bigger than what came in.
          if (png.size > BIGGEST) return setRefused(tooBig(png.size));
          const b = new Uint8Array(await png.arrayBuffer());
          let raw = "";
          for (let i = 0; i < b.length; i += 0x8000)
            raw += String.fromCharCode(...b.subarray(i, i + 0x8000));
          to.send(JSON.stringify({ picture: btoa(raw) }));
          to.send(encoder.encode("\x16"));
        });
      };
      el.addEventListener("paste", pasted, true);

      t.onData((d) => {
        if (armed.current && d.length === 1 && /[a-z]/i.test(d)) {
          armed.current = false;
          setCtrl(false);
          d = String.fromCharCode(d.toUpperCase().charCodeAt(0) & 0x1f);
        }
        socket.current?.send(encoder.encode(d));
      });
      t.onBinary((d) =>
        socket.current?.send(Uint8Array.from(d, (c) => c.charCodeAt(0))),
      );
      t.onResize(({ cols, rows }) =>
        socket.current?.send(JSON.stringify({ resize: { cols, rows } })),
      );

      const connect = async () => {
        try {
          const first = opening.current;
          const next = await liveSocket("talk", {
            cols: String(t.cols),
            rows: String(t.rows),
            // Only the first time: a socket that drops and comes back
            // asks for no new shell.
            ...(first ? { fresh: "1" } : {}),
          });
          opening.current = false;
          // A window just opened wants the shell it was given; any other
          // wants the one it was left on.
          const kept = localStorage.getItem(ON(id));
          back.current =
            first || kept === null || !Number.isInteger(Number(kept))
              ? null
              : Number(kept);
          if (stopped) return next.close();
          socket.current = next;
          setAway(null);
          // The session redraws itself whole for a client that arrives, so
          // whatever the last one left is cleared first.
          t.reset();
          // How big this is now, told again on arrival: the size the
          // socket was opened for may be stale by the time it is open.
          fit.fit();
          next.send(JSON.stringify({ resize: { cols: t.cols, rows: t.rows } }));
          next.onmessage = (m) => {
            if (m.data instanceof ArrayBuffer) t.write(new Uint8Array(m.data));
            else {
              const said = JSON.parse(m.data as string) as {
                open?:
                  string | { port?: number; path?: string; file?: boolean };
                windows?: Window[];
              };
              // An address is offered, to be opened on this device. A
              // port or a file of theirs is already theirs to reach, so
              // the desktop opens it and the window is the answer.
              if (typeof said.open === "string")
                setOffered(forThisDevice(said.open));
              else if (said.open)
                window.postMessage(
                  { maslow: "open", ...said.open },
                  location.origin,
                );
              if (said.windows) {
                setWindows(said.windows);
                // The machine's own word on which shell is in view replaces
                // the one marked under the hand, as soon as it agrees.
                const list = said.windows;
                setPicked((p) =>
                  p === null || list.some((w) => w.index === p && w.on)
                    ? null
                    : p,
                );
                // The shell this terminal was left on, turned back to the
                // moment the machine says it is still there; from then on
                // whichever is in view is the one remembered.
                const to = back.current;
                back.current = null;
                if (said.windows.some((w) => w.index === to && !w.on))
                  next.send(JSON.stringify({ select: to }));
                else {
                  const on = said.windows.find((w) => w.on);
                  if (on) localStorage.setItem(ON(id), String(on.index));
                }
              }
            }
          };
          next.onclose = () => {
            socket.current = null;
            if (stopped) return;
            setAway("Reconnecting…");
            timer = setTimeout(connect, 1000);
          };
        } catch (err) {
          if (stopped) return;
          setAway((err as Error).message);
          timer = setTimeout(connect, 5000);
        }
      };
      wake = () => void connect();
      void connect();

      undo = () => {
        el.removeEventListener("paste", pasted, true);
        sized.disconnect();
        look.disconnect();
        socket.current?.close();
        t.dispose();
        term.current = null;
      };
    };
    void start();

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(picking.current);
      document.removeEventListener("visibilitychange", resume);
      undo();
    };
  }, []);

  return (
    // One surface: the bar, the shells down the side and the paper, inside
    // a single frame on a page of its own, and flush to the edges in a
    // window, where the window is the frame.
    <div
      className={cx(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default",
        "[html[data-framed]_&]:rounded-none [html[data-framed]_&]:border-0",
      )}
    >
      <p id={LEAVING} className="sr-only">
        {ESCAPE}
      </p>
      {/* An address the machine asked to open, opened here by the person's
          own click, so their browser treats it as theirs. It is shown cut
          to the width there is, and copied whole, since an address broken
          across the terminal's rows cannot be picked up from them. */}
      {offered && (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-separator-border bg-background-secondary-default px-2 py-1.5">
            <span className="shrink-0 text-caption-1-regular text-text-tertiary">
              Your computer asked to open
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <span className="min-w-0 truncate text-body-regular text-text-secondary">
                {offered}
              </span>
              <IconButton
                size="small"
                icon={copied ? RiCheckLine : RiFileCopyLine}
                aria-label="Copy the address"
                onClick={() => {
                  void navigator.clipboard.writeText(offered);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              />
            </span>
            <Button
              size="small"
              variant="secondary"
              onClick={() => {
                window.postMessage(
                  { maslow: "open", url: offered },
                  location.origin,
                );
                setOffered(null);
              }}
            >
              Open in the computer's browser
            </Button>
            <Button
              size="small"
              onClick={() => {
                window.open(offered, "_blank", "noopener");
                setOffered(null);
              }}
            >
              Open on this device
            </Button>
            <CloseButton
              size="sm"
              aria-label="Dismiss"
              onClick={() => setOffered(null)}
            />
          </div>
          {/* A sign-in that answers to the machine ends on a page this device
            cannot load. Saying so beforehand turns a dead end into a step. */}
          {endsInACode(offered) && (
            <p className="border-b border-separator-border px-2 py-2 text-caption-1-regular text-text-secondary">
              Sign in on this device. At the end it shows a code: copy it, come
              back here, and paste it at the{" "}
              <code>Paste code here if prompted &gt;</code> prompt.
            </p>
          )}
        </>
      )}
      {/* Why something did not happen, in a sentence. */}
      {refused !== null && (
        <p className="border-b border-separator-border px-2 py-2 text-caption-1-regular text-text-secondary">
          {refused}
        </p>
      )}
      {/* Words this device's browser would not take: shown so they can
          be picked up by hand instead. */}
      {kept !== null && (
        <div className="flex items-center gap-2 border-b border-separator-border bg-background-secondary-default px-2 py-2">
          <span className="shrink-0 text-caption-1-regular text-text-secondary">
            Your browser kept the clipboard:
          </span>
          <code className="min-w-0 flex-1 truncate font-mono text-caption-1-regular select-all">
            {kept}
          </code>
          <CloseButton
            size="sm"
            aria-label="Dismiss"
            onClick={() => setKept(null)}
          />
        </div>
      )}
      {/* The terminal's controls, together at the far end of the bar, away
          from the name: the list of shells shown or hidden, and the shell
          in view split beside or below itself, as Command-D and
          Command-Shift-D do. */}
      <InBar
        as={(controls) => (
          <div className="flex h-8 shrink-0 items-center justify-end border-b border-separator-border px-2">
            {controls}
          </div>
        )}
      >
        <span className="ml-auto flex items-center gap-1">
          <BarButton
            ref={leave}
            icon={RiSideBarLine}
            label={shown ? "Hide the shells list" : "Show the shells list"}
            pressed={shown}
            title={ESCAPE}
            onClick={toggleRail}
            className={cx(!shown && "text-foreground-icon-tertiary")}
          />
          <BarButton
            icon={RiLayoutColumnLine}
            label="Split beside"
            title="Split beside (⌘D)"
            onClick={() => socket.current?.send(encoder.encode(`${PREFIX}%`))}
          />
          <BarButton
            icon={RiLayoutRowLine}
            label="Split below"
            title="Split below (⌘⇧D)"
            onClick={() => socket.current?.send(encoder.encode(`${PREFIX}"`))}
          />
        </span>
      </InBar>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        {/* The session's shells: down the side on a wide window, where the
            list has room to stand beside the terminal; from a sheet on a
            phone, where it would otherwise cost the terminal its width.
            One line each, the one in view marked, a tap turns this
            terminal to it, and the plus opens another. Every terminal on
            the desktop shares the same shells and each looks at one of its
            own. */}
        {(() => {
          const rows = (
            <>
              <div className="flex shrink-0 items-center justify-between gap-2 sm:pl-2">
                <span className="hidden text-caption-1-medium text-text-secondary sm:block">
                  Shells
                </span>
                <button
                  type="button"
                  aria-label="New shell"
                  onClick={() => {
                    say({ window: "new" });
                    if (!wide) setSheet(false);
                  }}
                  className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-background-tertiary-default text-foreground-icon-secondary transition-colors duration-fast ease-plain outline-none hover:bg-background-tertiary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                >
                  <RiAddLine className="size-4" aria-hidden />
                </button>
              </div>
              <AnimatePresence initial={false}>
                {windows.map((w) => {
                  // Which shell is in view: the one just picked while the
                  // machine is still answering, the machine's own after.
                  const on = picked === null ? w.on : picked === w.index;
                  return (
                    <motion.div
                      key={w.index}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, transition: LEAVE }}
                      transition={FAST}
                      className="group/row relative shrink-0"
                    >
                      {naming === w.index ? (
                        // The name in place of itself: one field, in the row
                        // it names, with the same mark and number beside it.
                        <div className="flex w-full items-center gap-2 rounded-2lg bg-background-secondary-default p-2">
                          <RiTerminalBoxLine
                            className="size-5 shrink-0 text-foreground-icon-secondary"
                            aria-hidden
                          />
                          <input
                            autoFocus
                            aria-label={`Name of shell ${w.index}`}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => setNaming(null)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") {
                                const name = draft.trim();
                                if (name)
                                  say({ rename: { index: w.index, name } });
                                setNaming(null);
                              }
                              if (e.key === "Escape") setNaming(null);
                            }}
                            className="min-w-0 flex-1 bg-transparent text-body-medium text-text-primary outline-none"
                          />
                        </div>
                      ) : (
                        // The row's menu, on a right-click or a long press,
                        // holds what a double-click and the close do.
                        <ContextMenu>
                          <ContextMenuTrigger
                            render={
                              <button
                                type="button"
                                aria-current={on ? "true" : undefined}
                                onClick={() => {
                                  pick(w.index);
                                  if (!wide) setSheet(false);
                                }}
                                title="Double-click to rename"
                                onDoubleClick={() => name(w)}
                                className={cx(
                                  "flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 text-left outline-none",
                                  "focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                                  wide ? "h-7" : "min-h-11",
                                  windows.length > 1 && "pr-8",
                                  // The mark is a choice, not a hover: it lands the
                                  // moment it is made. Hover alone takes its time.
                                  on
                                    ? "bg-background-tertiary-default"
                                    : "transition-colors duration-fast ease-plain hover:bg-background-secondary-hover",
                                )}
                              />
                            }
                          >
                            <RiTerminalBoxLine
                              className="size-4 shrink-0 text-accent-500"
                              aria-hidden
                            />
                            <span
                              className={cx(
                                "truncate text-body-regular",
                                on
                                  ? "text-text-primary"
                                  : "text-text-secondary",
                              )}
                            >
                              {shellName(w.name)}
                            </span>
                            <span
                              className={cx(
                                "ml-auto shrink-0 text-caption-1-medium tabular-nums",
                                "text-text-secondary",
                              )}
                            >
                              {w.index}
                            </span>
                          </ContextMenuTrigger>
                          {/* The menu leaves the hand where it is: Rename
                            puts it in the name field, and a menu that took
                            it back would close the field at once. */}
                          <ContextMenuContent finalFocus={false}>
                            <ContextMenuItem onClick={() => name(w)}>
                              Rename
                            </ContextMenuItem>
                            {windows.length > 1 && (
                              <ContextMenuItem
                                onClick={() => say({ close: w.index })}
                              >
                                Close
                              </ContextMenuItem>
                            )}
                          </ContextMenuContent>
                        </ContextMenu>
                      )}
                      {/* Closes the shell, whatever is in it; the last one has
                        no close, since it would take the terminal with it. */}
                      {windows.length > 1 && naming !== w.index && (
                        <CloseButton
                          size="xs"
                          aria-label={`Close shell ${w.index}`}
                          onClick={() => say({ close: w.index })}
                          className={cx(
                            // 20 of disc in a 24 target, as a finger needs.
                            "absolute top-1/2 right-1.5 -translate-y-1/2 before:absolute before:-inset-0.5 before:content-['']",
                            "opacity-0 transition-opacity duration-instant ease-plain group-hover/row:opacity-100 focus-visible:opacity-100",
                            on &&
                              "bg-accent-700 text-text-white hover:bg-accent-800 hover:text-text-white",
                          )}
                        />
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </>
          );
          return wide ? (
            <nav
              aria-label="Shells"
              className={cx(
                "flex w-48 shrink-0 flex-col gap-1 overflow-x-visible overflow-y-auto border-r border-separator-border bg-background-secondary-default/55 p-2",
                rail ? "flex" : "hidden",
              )}
            >
              {rows}
            </nav>
          ) : (
            <Sheet open={sheet} onOpenChange={setSheet}>
              <SheetContent
                side="bottom"
                className="max-h-[70dvh] gap-2 rounded-t-3xl p-3"
              >
                <SheetTitle className="sr-only">Shells</SheetTitle>
                <nav
                  aria-label="Shells"
                  className="flex flex-col gap-1 overflow-y-auto"
                >
                  {rows}
                </nav>
              </SheetContent>
            </Sheet>
          );
        })()}
        <div className="relative min-h-0 flex-1">
          {/* A tap anywhere on it brings the keyboard, on a phone as on a desktop. */}
          <div
            ref={box}
            // The terminal's own stylesheet clears its scrolling box to
            // black, which the renderer never paints over; the paper is the
            // page's, in both looks.
            className="absolute inset-0 bg-background-primary-default p-2 [&_.xterm-viewport]:bg-background-primary-default!"
            onClick={() => term.current?.focus()}
          />
          {/* Whether the machine is still on the other end, said where the
              words it is writing are. */}
          <AnimatePresence>
            {away && (
              <motion.p
                role="status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: LEAVE }}
                transition={FAST}
                className="pointer-events-none absolute top-2 right-3 rounded-full bg-background-tertiary-default px-2 py-0.5 text-caption-1-medium text-text-secondary"
              >
                {away}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
      {/* On a phone, the keys a shell needs that its keyboard lacks: a
          strip along the bottom, over the keyboard, each key sent as the
          terminal would send it. */}
      {folded && (
        <div className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-t border-separator-border bg-background-secondary-default px-1.5 pt-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:h-9">
          {KEYS.map((k) => (
            <button
              key={k.label}
              type="button"
              aria-label={k.title ?? k.label}
              aria-pressed={k.label === "Ctrl" ? ctrl : undefined}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                if (k.label === "Ctrl") {
                  armed.current = !armed.current;
                  setCtrl(armed.current);
                } else if (k.label === "Paste") {
                  void navigator.clipboard
                    .readText()
                    .then(
                      (text) =>
                        text && socket.current?.send(encoder.encode(text)),
                    )
                    .catch(() => {});
                } else socket.current?.send(encoder.encode(k.send));
                term.current?.focus();
              }}
              className={cx(
                "min-w-11 shrink-0 rounded-lg px-2.5 font-mono text-body-regular text-text-primary transition-colors duration-fast ease-plain active:bg-background-tertiary-default",
                k.label === "Ctrl" && ctrl
                  ? "bg-accent-500 text-white"
                  : "bg-background-primary-default shadow-xs",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
