import { writeFile } from "node:fs/promises";

import gifenc from "gifenc";
import type { Page } from "playwright";
import { PNG } from "pngjs";

// gifenc is a CommonJS module; its three calls come off the default.
const { GIFEncoder, applyPalette, quantize } = gifenc;

// A recording is bounded: so many frames, so many bytes, and past either
// the newest frames are kept and the oldest let go.
const MAX_FRAMES = 300;
const MAX_BYTES = 64 * 1024 * 1024;

type Shot = { data: Uint8Array; width: number; height: number };

// A recording of one tab: a frame per action on it, written as one GIF
// sized to its first frame; a frame of another size is cropped or padded
// to fit. What happens in other tabs is not in it.
export class Gif {
  recording = false;
  dropped = 0;
  private page: Page | null = null;
  private shots: Shot[] = [];
  private bytes = 0;

  get frames() {
    return this.shots.length;
  }

  start(page: Page) {
    this.recording = true;
    this.page = page;
    this.dropped = 0;
    this.shots = [];
    this.bytes = 0;
  }

  async frame(page: Page) {
    if (page !== this.page || page.isClosed()) return;
    const png = PNG.sync.read(await page.screenshot({ type: "png" }));
    // One frame bigger than the whole bound is let go on its own.
    if (png.data.length > MAX_BYTES) {
      this.dropped++;
      return;
    }
    this.shots.push({ data: png.data, width: png.width, height: png.height });
    this.bytes += png.data.length;
    while (
      this.shots.length > MAX_FRAMES ||
      (this.bytes > MAX_BYTES && this.shots.length > 1)
    ) {
      this.bytes -= this.shots.shift()!.data.length;
      this.dropped++;
    }
  }

  async save(path: string): Promise<{ frames: number; dropped: number }> {
    const gif = GIFEncoder();
    const first = this.shots[0];
    for (const s of this.shots) {
      const fitted = first ? fit(s, first.width, first.height) : s;
      const palette = quantize(fitted.data, 256);
      const index = applyPalette(fitted.data, palette);
      gif.writeFrame(index, fitted.width, fitted.height, {
        palette,
        delay: 800,
      });
    }
    gif.finish();
    await writeFile(path, gif.bytes());
    const out = { frames: this.shots.length, dropped: this.dropped };
    this.recording = false;
    this.page = null;
    this.shots = [];
    this.bytes = 0;
    return out;
  }
}

// The shot on a canvas of the given size: cropped where it is bigger,
// white where it is smaller.
function fit(s: Shot, width: number, height: number): Shot {
  if (s.width === width && s.height === height) return s;
  const data = new Uint8Array(width * height * 4).fill(255);
  const w = Math.min(width, s.width);
  for (let y = 0; y < Math.min(height, s.height); y++)
    data.set(
      s.data.subarray(y * s.width * 4, y * s.width * 4 + w * 4),
      y * width * 4,
    );
  return { data, width, height };
}
