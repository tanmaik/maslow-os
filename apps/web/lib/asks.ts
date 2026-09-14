import {
  acceptRequest,
  declineRequest,
  Invalid,
  type Subject,
  type Target,
} from "@maslow/brain";
import type { Query } from "@maslow/db";
import { computerOf, givePort } from "@maslow/db/computers";
import { answerRequestNotice } from "@maslow/db/notices";

// Answering an ask to share, wherever the person answers it: the brain's
// pages or the panel behind the clock. Accepting makes every share the ask
// names, in the person's name, and hands over any port it names on their
// own computer; either answer marks the notice that carried it, so one ask
// never waits in two places. Answers with the notice that carried the
// ask, and with what accepting shared and with whom, for the wakes that
// follow once it has landed.
export async function answerShareAsk(
  q: Query,
  userId: string,
  request: string,
  said: "accept" | "decline",
): Promise<{ notice: string | null; shared: Target[]; subjects: Subject[] }> {
  // The notice is marked first: answering takes the request away, and a
  // notice pointing at a request that is gone no longer knows which one it
  // carried. A refusal below rolls the whole answer back.
  const notice = await answerRequestNotice(
    q,
    request,
    said === "accept" ? "Accept" : "Decline",
  );
  if (said === "accept") {
    const made = await acceptRequest(q, request, async (port, to) => {
      const c = await computerOf(q, userId);
      if (!c) throw new Invalid("you have no computer to give a port of");
      await givePort(q, c.id, port, to);
    });
    return { notice, ...made };
  }
  await declineRequest(q, request);
  return { notice, shared: [], subjects: [] };
}
