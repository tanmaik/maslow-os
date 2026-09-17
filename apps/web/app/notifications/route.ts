import { Forbidden, Invalid, NotFound, stubs } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import {
  answerNotification,
  clearRead,
  markRead,
  notificationCounts,
  notificationOf,
  notificationsOf,
  Unanswerable,
} from "@maslow/db/notifications";
import { after, NextResponse } from "next/server";

import { answerShareAsk } from "@/lib/asks";
import { principal } from "@/lib/session";
import { Refused, told } from "@/lib/shares";

// What the panel behind the clock reads and answers through: the person's
// own notifications, how many wait on them, and the one answer a notification takes.

// Everything the panel shows in one answer: the notifications, how many wait,
// and the name of every record they point at, so a chip says the record
// rather than its id.
async function state(p: { orgId: string; personId: string; userId: string }) {
  return asPerson(p, async (q) => {
    const notifications = await notificationsOf(q, { limit: 100 });
    const about = await stubs(q, [
      ...new Set(notifications.flatMap((n) => n.records)),
    ]);
    return {
      notifications,
      titles: Object.fromEntries(about.map((r) => [r.id, r.title])),
      ...(await notificationCounts(q)),
    };
  });
}

export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return NextResponse.json(await state(p), {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const said = (await request.json().catch(() => null)) as {
    id?: string;
    answer?: string;
    read?: boolean;
    clear?: boolean;
  } | null;
  if (!said) return new Response(null, { status: 400 });
  try {
    const files = await asPerson(p, async (q) => {
      if (said.read) await markRead(q);
      if (said.clear) await clearRead(q);
      if (said.id && said.answer !== undefined) {
        // An ask to share carries a request, and answering the notification is
        // answering the request: the same path the brain's pages take.
        const notification = await notificationOf(q, said.id);
        if (!notification) throw new Unanswerable(`no notification ${said.id}`);
        if (notification.request) {
          if (said.answer !== "Accept" && said.answer !== "Decline")
            throw new Unanswerable("answer with Accept or Decline");
          return (
            await answerShareAsk(
              q,
              p,
              notification.request,
              said.answer === "Accept" ? "accept" : "decline",
            )
          ).files;
        } else await answerNotification(q, said.id, said.answer);
      }
      return [];
    });
    after(() => told(p, files));
  } catch (err) {
    if (
      err instanceof Unanswerable ||
      err instanceof Invalid ||
      err instanceof NotFound ||
      err instanceof Forbidden ||
      err instanceof Refused
    ) {
      return NextResponse.json({ said: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json(await state(p), {
    headers: { "cache-control": "no-store" },
  });
}
