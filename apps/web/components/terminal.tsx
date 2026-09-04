"use client";

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

// A shell on the person's disk: keys go to the machine over the socket,
// the screen comes back. The link is signed and short-lived; a socket that
// closes is shown closed, and a reload opens a new one.
export function Terminal({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  useEffect(() => {
    const term = new Xterm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: { background: "#0a0a0a" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(box.current!);
    fit.fit();
    // One session per browser tab, picked up again after every page load.
    let session = sessionStorage.getItem("terminal-session");
    if (!session) {
      session = crypto.randomUUID();
      sessionStorage.setItem("terminal-session", session);
    }
    const ws = new WebSocket(`${url}?session=${session}`);
    ws.binaryType = "arraybuffer";
    const encoder = new TextEncoder();
    const resize = () => {
      fit.fit();
      if (ws.readyState === ws.OPEN)
        ws.send(JSON.stringify({ resize: [term.cols, term.rows] }));
    };
    ws.onopen = () => {
      setState("open");
      resize();
      term.focus();
    };
    ws.onmessage = (e) =>
      term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
    ws.onclose = () => setState("closed");
    ws.onerror = () => setState("closed");
    const keys = term.onData((d) => {
      if (ws.readyState === ws.OPEN) ws.send(encoder.encode(d));
    });
    const watch = new ResizeObserver(resize);
    watch.observe(box.current!);
    return () => {
      watch.disconnect();
      keys.dispose();
      ws.onclose = null;
      ws.onerror = null;
      ws.close();
      term.dispose();
    };
  }, [url]);
  return (
    <div
      className="relative h-full bg-[#0a0a0a] p-2"
      data-terminal={state}
      data-terminal-url={url}
    >
      <div ref={box} className="h-full" />
      {state !== "open" && (
        <p className="text-muted-foreground absolute top-2 right-3 text-xs">
          {state === "connecting" ? "Connecting…" : "Closed"}
        </p>
      )}
    </div>
  );
}
