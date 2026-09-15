import { asOrg, asPerson, asSelf } from "@maslow/db";
import {
  arrive as record,
  arrivalDelivered,
  arrivalOf,
  arrivalWrote,
  claimArrival,
  holdsArrival,
  membersOf,
  releaseArrival,
  settleCadence,
  type Mode,
} from "@maslow/db/arrival";
import type { Principal } from "@maslow/db/auth";

import {
  files,
  onImage,
  plain,
  ready,
  runHeartbeat,
  tellCadence,
} from "./computer.ts";

// How often the agent runs for each answer: not at all, every half hour
// to keep the bar current, or once a day to keep the desk in order.
const CADENCE: Record<Mode, number> = { off: 0, bar: 30, desk: 1440 };

// What each answer says to the agent, in the person's own file on their
// computer, in words they could have written.
const SAID: Record<Mode, string | null> = {
  off: null,
  bar: "When something needs my attention, tell me in the notification bar. Leave my desk alone.",
  desk: "Keep my desk arranged: put what matters most on it as widgets you build, the most important at the top, and take off what is stale. Use the notification bar only for what I need to answer.",
};

// What marks the section arriving wrote, a comment markdown does not show.
const MARK = "<!-- maslow: written when you arrived -->";

// A promise, or a refusal once the moment is up.
const within = <T>(ms: number, p: Promise<T>): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, refuse) =>
      setTimeout(
        () => refuse(new Error("the computer did not answer in time")),
        ms,
      ),
    ),
  ]);

// The person answered the card, or skipped it: the answer is written
// down, once, holding their own row so two tabs queue rather than
// deadlock, and delivered to their computer now if it is ready, or when
// it is. A delivery that fails now is said by the desk's asking after the
// computer, and tried again there.
export async function arrive(
  p: Principal,
  answer: { mode: Mode; words: string | null } | null,
): Promise<void> {
  const written = await asSelf(p, (q) =>
    record(q, answer && { ...answer, every: CADENCE[answer.mode] }),
  );
  if (!written) return;
  await deliverArrival(p).catch((err: Error) =>
    console.error(`arrival ${p.personId}: ${err.message}`),
  );
}

// Gives a ready computer what its person said on arriving, in this
// order: their wish into their own file, a first run told what they are
// working toward, then the cadence, so no clock run comes ahead of the
// first. One delivery at a time holds the arrival; each step is its own
// short transaction with nothing of a vendor's inside; a delivery that
// fails lets go and the next ask after the computer tries again.
export async function deliverArrival(p: Principal): Promise<void> {
  const c = await ready(p);
  if (!c) return;
  const owed = await asPerson(p, claimArrival);
  if (!owed) return;
  try {
    if (owed.mode !== "off") {
      // A door from before the heartbeat's keys would run a retried ask
      // twice: the arrival waits for the update.
      if (!(await onImage(c)))
        throw new Error(
          "Your computer needs its update first; it is offered under Settings, Computer.",
        );
      const mine = await files(p);
      if (!mine) throw new Error("the computer stopped answering");
      // The wish, added to the end of their file once: after whatever they
      // have, marked so a write whose answer was lost is seen in the file
      // itself, and only while this delivery still holds the arrival.
      if (!owed.wrote) {
        const had = await within(
          20_000,
          mine.read("CLAUDE.md").then(
            (r) => r.text(),
            (err: Error) => {
              if (/No such file|\b404\b/.test(err.message)) return "";
              throw err;
            },
          ),
        );
        if (!(await asPerson(p, (q) => holdsArrival(q, owed))))
          throw new Error("another delivery took over");
        if (!had.includes(MARK))
          await mine.write(
            "CLAUDE.md",
            `${had ? "\n" : ""}# How I want my agent to work\n\n${SAID[owed.mode]}\n${MARK}\n`,
            true,
          );
        await asPerson(p, (q) => arrivalWrote(q, owed));
      }
      // Their words, kept in the agent's own folder too, so a first run
      // that dies before reading its reason leaves them for the next.
      const said = owed.words && plain(owed.words);
      if (said)
        await mine.write(
          ".maslow/heartbeat/arrival.md",
          `# What the person said they are working toward, when they arrived\n\n${owed.words}\n`,
        );
      const heard = await runHeartbeat(
        p,
        said
          ? `the person just arrived and said what they are working toward (kept in ~/.maslow/heartbeat/arrival.md): ${said}`
          : "the person just arrived",
        `arrival:${p.userId}`,
      );
      if (!heard) throw new Error("the computer stopped answering");
    }
    await asPerson(p, settleCadence);
    await tellCadence(p);
  } catch (err) {
    await asPerson(p, (q) => releaseArrival(q, owed));
    throw err;
  }
  await asPerson(p, (q) => arrivalDelivered(q, owed));
}

// Delivers what every computer of an org is still owed, for the hourly
// sweep, which is what makes a computer ready when nobody is at the
// desk; each member's arrival is theirs alone, so each is asked after in
// their own name.
export async function deliverArrivals(orgId: string): Promise<void> {
  for (const u of await asOrg(orgId, membersOf)) {
    const p: Principal = {
      orgId,
      userId: u.userId,
      personId: u.personId,
      role: u.role as Principal["role"],
    };
    const { owed } = await asPerson(p, arrivalOf).catch(
      (): { owed: boolean } => ({ owed: false }),
    );
    if (owed)
      await deliverArrival(p).catch((err: Error) =>
        console.error(`arrival ${u.personId}: ${err.message}`),
      );
  }
}
