import { backupsOf, restore } from "@/lib/computer";
import { principal } from "@/lib/session";

// The backups kept of this person's home, and the restore under way if
// there is one: the Computer pane lists them and watches one land.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  try {
    return Response.json(await backupsOf(p));
  } catch (err) {
    console.error(`backups ${p.personId}: ${(err as Error).message}`);
    return new Response("Your backups could not be read just now.", {
      status: 503,
    });
  }
}

// One of them fetched back into a folder of its own in the home. Nothing
// is ever written over: the answer names the folder it is landing in.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const ask = (await request.json().catch(() => null)) as { key?: unknown };
  if (typeof ask?.key !== "string")
    return new Response("An ask names the backup.", { status: 400 });
  try {
    const name = await restore(p, ask.key);
    if (!name)
      return new Response(
        "That backup cannot be restored just now: either it is not yours, your computer is not ready, or one is already coming back.",
        { status: 409 },
      );
    return Response.json({ name });
  } catch (err) {
    console.error(`restore ${p.personId}: ${(err as Error).message}`);
    return new Response("That backup could not be brought back. Try again.", {
      status: 409,
    });
  }
}
