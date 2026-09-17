"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The browser's ear: the microphone, cut to 16 kHz mono and streamed to
// Deepgram as the person speaks, whose words come back as they are heard
// and refine while they are still being said. One hold, or one click, is
// one stream; the microphone itself is kept open between them so the
// second hold costs nothing.
export type Ear = {
  // Everything heard so far in this stream, the last words still settling.
  heard: string;
  // How loud the person is this moment, 0 to 1, for the button to breathe.
  level: number;
  on: boolean;
  // Why nothing can be heard, when nothing can.
  why: string | null;
  start: () => Promise<void>;
  // Ends the stream and answers with everything heard, settled.
  stop: () => Promise<string>;
  cancel: () => void;
};

// What runs beside the audio thread: every input sample averaged down to
// 16 kHz, sent on as 100 ms of signed 16-bit samples with how loud they
// were.
const EAR = `
class Ear extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / 16000;
    this.acc = 0;
    this.sum = 0;
    this.n = 0;
    this.out = [];
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i];
      this.n++;
      this.acc++;
      if (this.acc >= this.step) {
        this.acc -= this.step;
        this.out.push(Math.max(-1, Math.min(1, this.sum / this.n)));
        this.sum = 0;
        this.n = 0;
      }
    }
    if (this.out.length >= 1600) {
      const pcm = new Int16Array(this.out.length);
      let power = 0;
      for (let i = 0; i < this.out.length; i++) {
        pcm[i] = this.out[i] * 32767;
        power += this.out[i] * this.out[i];
      }
      const level = Math.min(1, Math.sqrt(power / this.out.length) * 6);
      this.out = [];
      this.port.postMessage({ pcm: pcm.buffer, level }, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor("ear", Ear);
`;

type Heard = {
  type: string;
  is_final?: boolean;
  channel?: { alternatives?: { transcript?: string }[] };
};

export function useEar(): Ear {
  const [heard, setHeard] = useState("");
  const [level, setLevel] = useState(0);
  const [on, setOn] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const mic = useRef<{ ctx: AudioContext; node: AudioWorkletNode } | null>(
    null,
  );
  const ws = useRef<WebSocket | null>(null);
  const said = useRef({ settled: "", settling: "" });

  // The microphone, opened once and kept: the audio thread is wired to
  // whichever stream is open at the moment.
  const listen = async () => {
    if (mic.current) return mic.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(
      URL.createObjectURL(new Blob([EAR], { type: "text/javascript" })),
    );
    const node = new AudioWorkletNode(ctx, "ear");
    node.port.onmessage = (
      e: MessageEvent<{ pcm: ArrayBuffer; level: number }>,
    ) => {
      if (ws.current?.readyState === WebSocket.OPEN)
        ws.current.send(e.data.pcm);
      setLevel(e.data.level);
    };
    ctx.createMediaStreamSource(stream).connect(node);
    mic.current = { ctx, node };
    return mic.current;
  };
  useEffect(
    () => () => {
      ws.current?.close();
      void mic.current?.ctx.close();
    },
    [],
  );

  const start = useCallback(async () => {
    setWhy(null);
    if (ws.current) return;
    try {
      const res = await fetch("/speech/ticket", { method: "POST" });
      if (!res.ok) {
        setWhy((await res.text()) || "Nothing can be heard right now.");
        return;
      }
      const { url, token } = (await res.json()) as {
        url: string;
        token: string;
      };
      const { ctx } = await listen();
      await ctx.resume();
      said.current = { settled: "", settling: "" };
      setHeard("");
      const socket = new WebSocket(url, ["bearer", token]);
      socket.onmessage = (m: MessageEvent<string>) => {
        const w = JSON.parse(m.data) as Heard;
        if (w.type !== "Results") return;
        const words = w.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
        const s = said.current;
        if (w.is_final) {
          if (words) s.settled = s.settled ? `${s.settled} ${words}` : words;
          s.settling = "";
        } else s.settling = words;
        setHeard([s.settled, s.settling].filter(Boolean).join(" "));
      };
      socket.onclose = () => {
        if (ws.current === socket) ws.current = null;
        setOn(false);
        setLevel(0);
      };
      socket.onerror = () => setWhy("The ear dropped the line.");
      ws.current = socket;
      setOn(true);
    } catch (err) {
      setWhy(
        (err as Error).name === "NotAllowedError"
          ? "The microphone is not allowed on this device."
          : "Nothing can be heard right now.",
      );
    }
  }, []);

  // The stream told it is over waits for the last words to settle, then
  // closes from the far end.
  const stop = useCallback(() => {
    const socket = ws.current;
    if (!socket) return Promise.resolve("");
    return new Promise<string>((done) => {
      const finish = () => {
        clearTimeout(clock);
        const s = said.current;
        done([s.settled, s.settling].filter(Boolean).join(" ").trim());
      };
      const clock = setTimeout(() => {
        socket.close();
        finish();
      }, 2000);
      socket.addEventListener("close", finish, { once: true });
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: "CloseStream" }));
      else socket.close();
    });
  }, []);

  const cancel = useCallback(() => {
    ws.current?.close();
    ws.current = null;
    said.current = { settled: "", settling: "" };
    setHeard("");
    setOn(false);
    setLevel(0);
  }, []);

  return { heard, level, on, why, start, stop, cancel };
}
