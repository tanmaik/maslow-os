import { Forbidden, Invalid, NotFound, stubs } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import {
  answerNotice,
  clearRead,
  markRead,
  noticeCounts,
  noticeOf,
  noticesOf,
  Unanswerable,
} from "@maslow/db/notices";
import { after, NextResponse } from "next/server";

import { answerShareAsk } from "@/lib/asks";
import { wakeAnswered, wakeShared } from "@/lib/computer";
import { principal } from "@/lib/session";

// What the panel behind the clock reads and answers through: the person's
// own notices, how many wait on them, and the one answer a notice takes.

// Everything the panel shows in one answer: the notices, how many wait,
// and the name of every record they point at, so a chip says the record
// rather than its id.
async function state(p: { orgId: string; personId: string; userId: string }) {
  return asPerson(p, async (q) => {
    const notices = await noticesOf(q, { limit: 100 });
    const about = await stubs(q, [
      ...new Set(notices.flatMap((n) => n.records)),
    ]);
    return {
      notices,
      titles: Object.fromEntries(about.map((r) => [r.id, r.title])),
      ...(await noticeCounts(q)),
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
    await asPerson(p, async (q) => {
      if (said.read) await markRead(q);
      if (said.clear) await clearRead(q);
      if (said.id && said.answer !== undefined) {
        // An ask to share carries a request, and answering the notice is
        // answering the request: the same path the brain's pages take.
        const notice = await noticeOf(q, said.id);
        if (!notice) throw new Unanswerable(`no notice ${said.id}`);
        if (notice.request) {
          if (said.answer !== "Accept" && said.answer !== "Decline")
            throw new Unanswerable("answer with Accept or Decline");
          const made = await answerShareAsk(
            q,
            p.userId,
            notice.request,
            said.answer === "Accept" ? "accept" : "decline",
          );
          after(() => wakeShared(p, made.shared, made.subjects));
        } else await answerNotice(q, said.id, said.answer);
        // The agent that asked hears the answer once it has landed.
        const id = said.id;
        const answer = said.answer;
        after(() => wakeAnswered(p, id, answer));
      }
    });
  } catch (err) {
    if (
      err instanceof Unanswerable ||
      err instanceof Invalid ||
      err instanceof NotFound ||
      err instanceof Forbidden
    ) {
      return NextResponse.json({ said: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json(await state(p), {
    headers: { "cache-control": "no-store" },
  });
}
