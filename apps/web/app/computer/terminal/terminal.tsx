"use client";

import "@fontsource-variable/jetbrains-mono";
import "@xterm/xterm/css/xterm.css";

import { XMarkIcon } from "@heroicons/react/24/solid";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as Xterm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
export function Terminal() {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<Xterm | null>(null);
  const [away, setAway] = useState<string | null>("Connecting…");
  const [offered, setOffered] = useState<string | null>(null);

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
              const said = JSON.parse(m.data as string) as { open?: string };
              if (said.open) setOffered(said.open);
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
          own click, so their browser treats it as theirs. */}
      {offered && (
        <div className="bg-muted flex items-center gap-2 border-b px-3 py-2 text-sm">
          <span className="text-muted-foreground min-w-0 flex-1 truncate">
            {offered}
          </span>
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
