"use client";

import "@fontsource-variable/jetbrains-mono";
import "@xterm/xterm/css/xterm.css";

import { XMarkIcon } from "@heroicons/react/24/solid";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as Xterm } from "@xterm/xterm";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { liveSocket } from "@/lib/live";

const FONT =
  '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, monospace';

// The terminal's colours, read from the product's theme as it is on the
// screen, so the terminal is in the same look as the page around it. Each
// is painted once and read back as plain hex, the one form the terminal's
// glyph painter takes.
function theme() {
  const at = getComputedStyle(document.documentElement);
  const ctx = document.createElement("canvas").getContext("2d")!;
  const v = (name: string) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = at.getPropertyValue(name).trim();
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b, a].map((n) => n!.toString(16).padStart(2, "0")).join("")}`;
  };
  return {
    background: v("--background"),
    foreground: v("--foreground"),
    cursor: v("--foreground"),
    cursorAccent: v("--background"),
    selectionBackground: v("--ring"),
  };
}

// The person's terminal, live: what they type goes to the machine as they
// type it, what the machine draws is drawn here, and the size follows the
// window. It is one tmux session on the machine, so closing this kills
// nothing and opening it again finds it as it was. An address printed in
// it is a link, and one the machine asks to open is offered above it;
// either opens on this device, with the person's own logins.
// A sign-in that will come back to a port on the machine, not on this
// device: the address says so, and a browser here cannot reach it. The
// page that fails carries the code in its own address, which the terminal
// takes when it is pasted back.
function comesBackToTheMachine(address: string): boolean {
  try {
    const back = new URL(address).searchParams.get("redirect_uri");
    return back !== null && back.startsWith("http://localhost:");
  } catch {
    return false;
  }
}

export function Terminal() {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<Xterm | null>(null);
  const [away, setAway] = useState<string | null>("Connecting…");
  const [offered, setOffered] = useState<string | null>(null);
  // Words the machine copied that this device's browser would not take.
  const [kept, setKept] = useState<string | null>(null);
  // A sign-in that went to the machine's own browser, where its answer
  // lands, and is waiting for the person's hands there.
  const [signIn, setSignIn] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let stopped = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
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
        // delete by word, as they do in a terminal on the desk.
        macOptionIsMeta: true,
      });
      term.current = t;
      const fit = new FitAddon();
      t.loadAddon(fit);
      t.loadAddon(new WebLinksAddon());
      t.open(el);
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

      // Words picked on the machine land on this device's clipboard. The
      // machine asks for that with OSC 52: the code, then the words in
      // base64. The ask rides the same socket as the drawing, so it
      // arrives while the hand that picked them is still what the browser
      // counts as the reason for writing.
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
        // A browser only takes the clipboard while a gesture is fresh, and
        // it refuses in a promise rather than at the call; on an address
        // it does not trust it has no clipboard to offer at all. However
        // it refuses, the words are shown instead, to be taken by hand.
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
      const MAC_KEYS: Record<string, string> = {
        Backspace: "\x15",
        ArrowLeft: "\x01",
        ArrowRight: "\x05",
      };
      t.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown" || !e.metaKey || e.ctrlKey || e.altKey)
          return true;
        const code = MAC_KEYS[e.key];
        if (!code) return true;
        e.preventDefault();
        ws?.send(new TextEncoder().encode(code));
        return false;
      });

      const encoder = new TextEncoder();
      t.onData((d) => ws?.send(encoder.encode(d)));
      t.onBinary((d) => ws?.send(Uint8Array.from(d, (c) => c.charCodeAt(0))));
      t.onResize(({ cols, rows }) =>
        ws?.send(JSON.stringify({ resize: { cols, rows } })),
      );

      const connect = async () => {
        try {
          const next = await liveSocket("talk", {
            cols: String(t.cols),
            rows: String(t.rows),
          });
          if (stopped) return next.close();
          ws = next;
          setAway(null);
          // The session redraws itself whole for a client that arrives, so
          // whatever the last one left is cleared first.
          t.reset();
          next.onmessage = (m) => {
            if (m.data instanceof ArrayBuffer) t.write(new Uint8Array(m.data));
            else {
              const said = JSON.parse(m.data as string) as {
                open?: string;
                signIn?: string;
              };
              if (said.open) setOffered(said.open);
              if (said.signIn) setSignIn(said.signIn);
            }
          };
          next.onclose = () => {
            ws = null;
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
      void connect();

      undo = () => {
        sized.disconnect();
        look.disconnect();
        ws?.close();
        t.dispose();
        term.current = null;
      };
    };
    void start();

    return () => {
      stopped = true;
      clearTimeout(timer);
      undo();
    };
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* An address the machine asked to open, opened here by the person's
          own click, so their browser treats it as theirs. It is shown cut
          to the width there is, and copied whole, since an address broken
          across the terminal's rows cannot be picked up from them. */}
      {offered && (
        <div className="bg-muted flex items-center gap-2 border-b px-3 py-2 text-sm">
          <span className="text-muted-foreground min-w-0 flex-1 truncate">
            {offered}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigator.clipboard.writeText(offered)}
          >
            Copy address
          </Button>
          <Button
            size="sm"
            onClick={() => {
              window.open(offered, "_blank", "noopener");
              setOffered(null);
            }}
          >
            Open {new URL(offered).host} on this device
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => setOffered(null)}
          >
            <XMarkIcon className="size-4" />
          </Button>
        </div>
      )}
      {/* A sign-in that answers to the machine ends on a page this device
          cannot load. Saying so beforehand turns a dead end into a step. */}
      {offered && comesBackToTheMachine(offered) && (
        <p className="text-muted-foreground border-b px-3 py-2 text-xs">
          After you sign in, this device lands on a page that will not load.
          That is expected: its address carries your code. Copy the address and
          paste it back in the terminal.
        </p>
      )}
      {/* A sign-in that answers to this machine was opened on the
          machine's own browser, since that is where its answer can land.
          It waits there for the person's own hands. */}
      {signIn && (
        <div className="bg-muted flex items-center gap-2 border-b px-3 py-2 text-sm">
          <span className="text-muted-foreground min-w-0 flex-1">
            This sign-in answers to your computer, so it opened on your
            agent&rsquo;s browser. Finish it there and the terminal has you
            signed in.
          </span>
          <Link
            href="/browser"
            className={buttonVariants({ size: "sm" })}
            onClick={() => setSignIn(null)}
          >
            Open the agent&rsquo;s browser
          </Link>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => setSignIn(null)}
          >
            <XMarkIcon className="size-4" />
          </Button>
        </div>
      )}
      {/* Words this device's browser would not take: shown so they can
          be picked up by hand instead. */}
      {kept !== null && (
        <div className="bg-muted flex items-center gap-2 border-b px-3 py-2 text-sm">
          <span className="text-muted-foreground shrink-0 text-xs">
            Your browser kept the clipboard:
          </span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs select-all">
            {kept}
          </code>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => setKept(null)}
          >
            <XMarkIcon className="size-4" />
          </Button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {/* A tap anywhere on it brings the keyboard, on a phone as on a desk. */}
        <div
          ref={box}
          className="bg-background absolute inset-0 p-2"
          onClick={() => term.current?.focus()}
        />
        {away && (
          <p className="text-muted-foreground pointer-events-none absolute top-2 right-3 text-xs">
            {away}
          </p>
        )}
      </div>
    </div>
  );
}
