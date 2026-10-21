// The trial's pretend computer, spoken to as the door would be: a socket
// that never leaves the page. The Terminal's socket gets a small shell
// that runs nothing, with history and Tab; the Files window's gets
// silence, since nothing on a read-only home ever changes. Loaded only
// when the trial says where its computer is.
import {
  complete,
  newShell,
  prompt,
  REPLAY,
  run,
  type Shell,
} from "./trial-computer.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type Listener = ((m: { data: unknown }) => void) | null;

class TrialSocket {
  readyState: number = WebSocket.OPEN;
  binaryType = "arraybuffer";
  onmessage: Listener = null;
  onclose: (() => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private shell: Shell = newShell();
  private line = "";
  private back = 0;
  private playing: ReturnType<typeof setTimeout>[] = [];

  constructor(private talks: boolean) {
    if (!talks) return;
    // The shell says hello once the Terminal has hung its listener.
    setTimeout(() => {
      this.say({ windows: [{ index: 0, name: "shell", on: true }] });
      this.write(
        "Welcome to the trial's computer. It is pretend: type help, or claude.\r\n\r\n" +
          prompt(this.shell),
      );
    }, 0);
  }

  private write(text: string) {
    const bytes = encoder.encode(text.replace(/\r?\n/g, "\r\n"));
    this.onmessage?.({ data: bytes.buffer });
  }

  private say(words: object) {
    this.onmessage?.({ data: JSON.stringify(words) });
  }

  // What the page sends: keys as bytes, its own words as JSON, which the
  // pretend shell has no use for.
  send(data: string | ArrayBufferView | ArrayBuffer) {
    if (!this.talks || typeof data === "string") return;
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.keys(decoder.decode(bytes));
  }

  private keys(d: string) {
    // While the recording plays, a Control-C stops it and nothing else
    // is taken.
    if (this.playing.length) {
      if (d.includes("\x03")) this.stopReplay("^C\r\n");
      return;
    }
    if (d === "\x1b[A" || d === "\x1b[B") return this.recall(d === "\x1b[A");
    if (d.startsWith("\x1b")) return;
    for (const ch of d) {
      if (ch === "\r") this.enter();
      else if (ch === "\x7f" || ch === "\b") {
        if (this.line) {
          this.line = this.line.slice(0, -1);
          this.write("\b \b");
        }
      } else if (ch === "\x03") {
        this.line = "";
        this.write(`^C\r\n${prompt(this.shell)}`);
      } else if (ch === "\x0c") {
        this.write(`\x1b[2J\x1b[H${prompt(this.shell)}${this.line}`);
      } else if (ch === "\t") {
        const done = complete(this.shell, this.line);
        this.write(done.slice(this.line.length));
        this.line = done;
      } else if (ch >= " ") {
        this.line += ch;
        this.write(ch);
      }
    }
  }

  // An earlier line in place of this one, or a later one.
  private recall(up: boolean) {
    const h = this.shell.history;
    this.back = Math.max(0, Math.min(h.length, this.back + (up ? 1 : -1)));
    const next = this.back ? h[h.length - this.back]! : "";
    this.write(`\r\x1b[2K${prompt(this.shell)}${next}`);
    this.line = next;
  }

  private enter() {
    const typed = this.line;
    this.line = "";
    this.back = 0;
    this.write("\r\n");
    const ran = run(this.shell, typed);
    if (ran.clear) this.write("\x1b[2J\x1b[H");
    if (ran.out) this.write(`${ran.out}\n`);
    if (ran.replay) return this.replay();
    this.write(prompt(this.shell));
  }

  // The recorded session, a line at a time, typed out as it was said.
  private replay() {
    let at = 0;
    for (const step of REPLAY) {
      this.playing.push(setTimeout(() => this.write(`${step.text}\n`), at));
      at += step.wait;
    }
    this.playing.push(setTimeout(() => this.stopReplay(""), at));
  }

  private stopReplay(said: string) {
    for (const t of this.playing) clearTimeout(t);
    this.playing = [];
    this.write(`${said}${prompt(this.shell)}`);
  }

  close() {
    for (const t of this.playing) clearTimeout(t);
    this.playing = [];
    this.readyState = WebSocket.CLOSED;
  }
}

export function trialSocket(path: "talk" | "view"): WebSocket {
  return new TrialSocket(path === "talk") as unknown as WebSocket;
}
