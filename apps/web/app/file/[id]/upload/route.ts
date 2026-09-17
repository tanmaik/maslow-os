import { principal } from "@/lib/session";
import { landedShared, uploadShared, writeShared } from "@/lib/shares";
import { bounded, Rejected } from "@/lib/storage";

import { opened, refused } from "../opened";

// The most a file weighs when it has to come through us, where nothing
// signs an address for the browser.
const THROUGH = 24 * 1024 * 1024;

// Where a colleague puts a file into a shared folder, or over a shared
// file, at edit: an address in the bucket signed for exactly those bytes,
// which the browser puts to itself. Null where the store signs nothing;
// then the bytes come here as the body of a PUT instead.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const got = await opened(request, params);
  if (!got) return new Response("Not found", { status: 404 });
  const p = (await principal())!;
  const body = (await request.json().catch(() => null)) as {
    bytes?: unknown;
  } | null;
  const bytes = body?.bytes;
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0)
    return new Response("How big is it?", { status: 400 });
  try {
    return Response.json(await uploadShared(p, got.o, got.at, bytes));
  } catch (err) {
    return refused(err);
  }
}

// What landed: the browser put the file in the bucket itself and says so,
// with the key it was given, under a header that says which this is; or,
// where nothing signs addresses, the file itself, written through us.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const got = await opened(request, params);
  if (!got) return new Response("Not found", { status: 404 });
  const p = (await principal())!;
  try {
    if (request.headers.get("x-maslow-upload") === "landed") {
      const body = (await request.json().catch(() => null)) as {
        key?: unknown;
      } | null;
      if (typeof body?.key !== "string")
        return new Response("Which upload?", { status: 400 });
      await landedShared(p, got.o, got.at, body.key);
      return new Response(null, { status: 204 });
    }
    const bytes = new Uint8Array(
      await (await bounded(request, THROUGH)).arrayBuffer(),
    );
    return Response.json(await writeShared(p, got.o, got.at, bytes));
  } catch (err) {
    if (err instanceof Rejected)
      return new Response(err.message, { status: 413 });
    return refused(err);
  }
}
