"use client";

import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

// A shell on the person's disk: keys go to the machine over the socket,
// the screen comes back. The tab names its session and asks for a link to
// it, which the app signs for that session alone. A socket that closes —
// the shell exited, the system was reset, the link aged — is opened again
// on a fresh link: on its own every few seconds for a couple of minutes,
// and on any key or click after that. Nothing typed goes unanswered.
const TRIES = 24;
export function Terminal() {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<Xterm>(null);
  const fit = useRef<FitAddon>(null);
  const [state, setState] = useState<"connecting" | "open" | "closed">(
    "connecting",
  );
  const [again, setAgain] = useState(0);
  const phase = useRef<"connecting" | "open" | "closed">("connecting");
  useEffect(() => {
    const t = new Xterm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: { background: "#0a0a0a" },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(box.current!);
    f.fit();
    term.current = t;
    fit.current = f;
    return () => {
      t.dispose();
      term.current = null;
    };
  }, []);
  useEffect(() => {
    const t = term.current!;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let gone = false;
    setState("connecting");
    phase.current = "connecting";
    const closed = () => {
      if (gone || timer) return;
      phase.current = "closed";
      setState("closed");
      if (again < TRIES) timer = setTimeout(() => setAgain(again + 1), 5000);
    };
    // One session per browser tab, picked up again after every page load;
    // a shell that exited is a new one under the same name.
    let session = sessionStorage.getItem("terminal-session");
    if (!session) {
      session = crypto.randomUUID();
      sessionStorage.setItem("terminal-session", session);
    }
    const encoder = new TextEncoder();
    const resize = () => {
      fit.current?.fit();
      if (ws && ws.readyState === ws.OPEN)
        ws.send(JSON.stringify({ resize: [t.cols, t.rows] }));
    };
    (async () => {
      const res = await fetch(`/computer/terminal?session=${session}`).catch(
        () => null,
      );
      if (gone) return;
      if (!res?.ok) return closed();
      const { url } = (await res.json()) as { url: string };
      if (gone) return;
      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        phase.current = "open";
        setState("open");
        // The machine sends the screen as it is; the old one goes.
        t.reset();
        resize();
        t.focus();
      };
      ws.onmessage = (e) =>
        t.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
      ws.onclose = closed;
      ws.onerror = closed;
    })();
    const keys = t.onData((d) => {
      // A socket on its way closed is closed; a key into a closed shell
      // opens a new one, now.
      if (ws && ws.readyState === ws.OPEN) {
        try {
          return ws.send(encoder.encode(d));
        } catch {
          closed();
        }
      } else if (phase.current === "open") closed();
      if (phase.current !== "closed") return;
      clearTimeout(timer);
      timer = undefined;
      setAgain((n) => n + 1);
    });
    const watch = new ResizeObserver(resize);
    watch.observe(box.current!);
    return () => {
      gone = true;
      clearTimeout(timer);
      watch.disconnect();
      keys.dispose();
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }, [again]);
  return (
    <div className="relative h-full bg-[#0a0a0a] p-2" data-terminal={state}>
      <div ref={box} className="h-full" />
      {state !== "open" && (
        <button
          type="button"
          onClick={() => setAgain((n) => n + 1)}
          className="text-muted-foreground hover:text-foreground absolute top-2 right-3 text-xs"
        >
          {state === "connecting"
            ? again > 0
              ? "Opening a new shell…"
              : "Connecting…"
            : again < TRIES
              ? "The shell closed. A new one opens shortly, or press a key."
              : "The shell closed. Press a key or click here for a new one."}
        </button>
      )}
    </div>
  );
}
