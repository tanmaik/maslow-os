import { asPerson } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { owePicture, pictureOwed } from "@maslow/db/settings";
import {
  addWallpaper,
  ownWallpapers,
  removeWallpaper,
  wearWallpaper,
} from "@maslow/db/wallpapers";

import { PAPERS } from "@/app/desktop/wallpapers";
import { sweepMember } from "@/lib/meter";
import { CEILINGS } from "@/lib/prices";
import { settle } from "@/lib/orphans";
import { principal } from "@/lib/session";
import {
  bounded,
  imageOrThrow,
  pictureOrThrow,
  PUT_FOR,
  read,
  Rejected,
  storage,
} from "@/lib/storage";
import { kept, papersOf } from "@/lib/wallpapers";

// A wallpaper a person keeps is theirs at the resolution they made it, so
// a 4K picture arrives whole — and whole is more than a function's body
// takes, which is why the browser puts it in the bucket itself.
const LIMIT = 24 * 1024 * 1024;

// The key an object landed on, as a bucket of ours writes them.
const KEY = /^[0-9a-f]{32}\.(png|jpg|webp)$/;

// What the browser says a file is, as the extension its object takes.
// Anything else is refused before an address is signed for it.
const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

// Whether the person has room for another wallpaper. The ceiling is ours
// and never shows as a number: reaching it tells us and turns this one
// away in a sentence they can act on.
async function noRoom(p: Principal): Promise<string | null> {
  const own = await asPerson(p, ownWallpapers);
  const bytes = own.reduce((all, w) => all + w.bytes, 0);
  if (own.length < CEILINGS.wallpapers && bytes < CEILINGS.wallpaperBytes)
    return null;
  console.error(
    `wallpapers: member ${p.userId} at the ceiling, ${own.length} kept weighing ${bytes} bytes`,
  );
  return "You are keeping as many wallpapers as we hold. Take one away to add another.";
}

// The wallpapers a person has of their own, and the one they wear.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return Response.json(await asPerson(p, papersOf));
}

// Kept as the person's own, and worn at once.
const keep = (p: Principal, key: string, bytes: number) =>
  asPerson(p, async (q) => {
    const made = await addWallpaper(q, key, bytes);
    await wearWallpaper(q, `own:${key}`);
    return made;
  });

// Where to put a picture of the person's own: the key it will land on and
// an address in the bucket signed for exactly those bytes, which the
// browser puts to itself, so nothing of the size passes through us. Null
// where the store signs nothing, and the picture comes through here as a
// form instead, which is how a deployment with no bucket says so.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  if (!request.headers.get("content-type")?.includes("application/json"))
    return through(p, request);
  const body = (await request.json().catch(() => null)) as {
    type?: unknown;
    bytes?: unknown;
  } | null;
  const ext = EXT[String(body?.type)];
  if (!ext) return new Response("PNG, JPEG or WebP only.", { status: 415 });
  const bytes = body?.bytes;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0)
    return new Response("How big is it?", { status: 400 });
  if (bytes > LIMIT)
    return new Response("Images are limited to 24 MB.", { status: 413 });
  const full = await noRoom(p);
  if (full) return new Response(full, { status: 409 });
  const to = storage.putUrl(ext, bytes);
  // Owed from the moment it has an address, and due once that address
  // expires: an object nothing comes to show is deleted by the sweep, so
  // nothing that costs money ever sits in the bucket without a row, and
  // nothing is deleted while the browser is still putting it there.
  if (to) await asPerson(p, (q) => owePicture(q, p.orgId, to.key, PUT_FOR));
  return Response.json(to);
}

// A picture the browser put in the bucket itself, recorded once it is
// there and worn at once. Its bytes are read back, so what is kept is a
// picture and weighs what the ledger says it does.
export async function PUT(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    key?: unknown;
  } | null;
  const key = typeof body?.key === "string" ? body.key : "";
  if (!KEY.test(key)) return new Response("Which wallpaper?", { status: 400 });
  // Only the person the address was signed for may say what landed on it.
  if (!(await asPerson(p, (q) => pictureOwed(q, key))))
    return new Response("That upload is not yours.", { status: 403 });
  const bytes = await read(key);
  if (!bytes)
    return new Response("That picture never arrived.", { status: 404 });
  try {
    pictureOrThrow(bytes, LIMIT);
  } catch (err) {
    if (!(err instanceof Rejected)) throw err;
    await storage.delete(key);
    return new Response(err.message, { status: 415 });
  }
  return Response.json(kept(await keep(p, key, bytes.length)), {
    status: 201,
  });
}

// The picture itself, where the store signs no address for the browser:
// the fake one, and nowhere else.
async function through(p: Principal, request: Request) {
  const full = await noRoom(p);
  if (full) return new Response(full, { status: 409 });
  let image;
  try {
    const form = await (await bounded(request, LIMIT + 1024)).formData();
    image = await imageOrThrow(form.get("wallpaper"), LIMIT);
  } catch (err) {
    if (!(err instanceof Rejected)) throw err;
    // Too big is 413; anything else the person can fix by choosing another
    // file is 415.
    const big = /larger than|limited to/.test(err.message);
    return new Response(err.message, { status: big ? 413 : 415 });
  }
  const key = await storage.put(image.bytes, image.ext);
  return Response.json(kept(await keep(p, key, image.bytes.length)), {
    status: 201,
  });
}

// The wallpaper the desktop wears from now on: a built-in's name, or one of
// the person's own.
export async function PATCH(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    choice?: unknown;
  } | null;
  const choice = body?.choice;
  if (typeof choice !== "string")
    return new Response("Which wallpaper?", { status: 400 });
  const worn = await asPerson(p, async (q) => {
    const own = choice.startsWith("own:")
      ? (await ownWallpapers(q)).some((w) => w.key === choice.slice(4))
      : PAPERS.some((x) => x.id === choice);
    if (!own) return false;
    await wearWallpaper(q, choice);
    return true;
  });
  if (!worn)
    return new Response("There is no such wallpaper.", { status: 400 });
  return Response.json({ choice });
}

// One of the person's own, taken away: its object is owed its deletion,
// and a desktop wearing it falls back to the bare ground.
export async function DELETE(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return new Response("Which wallpaper?", { status: 400 });
  // What it held until this moment is metered before its row goes.
  await sweepMember(p.orgId, p.userId);
  const gone = await asPerson(p, (q) => removeWallpaper(q, key));
  if (!gone)
    return new Response("There is no such wallpaper.", { status: 404 });
  await settle(p.orgId);
  return new Response(null, { status: 204 });
}
