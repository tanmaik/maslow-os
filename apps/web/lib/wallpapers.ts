import type { Query } from "@maslow/db";
import { ownWallpapers, wallpaperOf } from "@maslow/db/wallpapers";

import type { Kept, Papers } from "@/app/desktop/wallpapers";
import { storage } from "@/lib/storage";

// One wallpaper of the person's own, with the address it is drawn from.
export const kept = (w: { key: string; bytes: number }): Kept => ({
  key: w.key,
  url: storage.url(w.key),
  bytes: w.bytes,
});

// What a person has to choose from beyond the built-ins, and the one they
// are wearing. Read in one place, whether a page asks or the room does.
export async function papersOf(q: Query): Promise<Papers> {
  return {
    choice: await wallpaperOf(q),
    own: (await ownWallpapers(q)).map(kept),
  };
}
