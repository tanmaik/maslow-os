import type { Query } from "./index.ts";

// How much a person wants their agent to do on its own: nothing, tell
// them in the bar, or arrange their desk.
export type Mode = "off" | "bar" | "desk";

// What a person said when they arrived, held until their computer is
// ready to be told.
export type Arrival = { mode: Mode; words: string | null };

// How much a person may say on the card.
export const MOST = 1500;

// Whether the person has answered the card that meets them on their
// first desk, and whether their computer is still owed what they said.
export async function arrivalOf(
  q: Query,
): Promise<{ arrived: boolean; owed: boolean }> {
  const row = (
    await q.query<{ arrived: boolean; owed: boolean }>(
      `select u.arrived_at is not null as arrived,
              exists (select 1 from arrivals a where a.member_id = u.id) as owed
       from users u where u.id = current_member()`,
    )
  ).rows[0];
  return row ?? { arrived: false, owed: false };
}

// Records the answer, once, with the cadence it chose written on the
// person's computer in the same breath: the card is answered from now
// on, and what was said waits for the computer; a card skipped leaves
// nothing owed and the cadence alone. False when it was answered
// already.
export async function arrive(
  q: Query,
  arrival: (Arrival & { every: number }) | null,
): Promise<boolean> {
  const { rowCount } = await q.query(
    `update users set arrived_at = now()
     where id = current_member() and arrived_at is null`,
  );
  if ((rowCount ?? 0) === 0) return false;
  if (arrival)
    await q.query(
      "insert into arrivals (mode, words, every) values ($1, $2, $3)",
      [arrival.mode, arrival.words, arrival.every],
    );
  return true;
}

// Gives the computer the cadence the person chose on arriving, unless
// they set one by hand in Settings since the answer, which is kept over
// it.
export async function settleCadence(q: Query): Promise<void> {
  // Under the computer's own lock, the one Settings writes under, so the
  // by-hand flag read here is the flag as Settings left it.
  await q.query(
    `select pg_advisory_xact_lock(hashtext('computer:' || c.id::text))
     from computers c where c.user_id = current_member()`,
  );
  await q.query(
    `update computers c set heartbeat_every = a.every
     from arrivals a
     where a.member_id = current_member() and c.user_id = a.member_id
       and not a.by_hand`,
  );
}

// The person set a cadence by hand in Settings: an answer still waiting
// keeps everything but that.
export async function cadenceByHand(q: Query): Promise<void> {
  await q.query(
    "update arrivals set by_hand = true where member_id = current_member()",
  );
}

// The current members of an org, as the sweep needs them to ask after
// each one's arrival in their own name.
export async function membersOf(
  q: Query,
): Promise<{ userId: string; personId: string; role: string }[]> {
  return (
    await q.query<{ userId: string; personId: string; role: string }>(
      `select id as "userId", person_id as "personId", role
       from users where removed_at is null and org_id = current_org()`,
    )
  ).rows;
}

// A delivery's hold on the arrival: a name for that delivery and no
// other.
export type Claim = {
  mode: Mode;
  words: string | null;
  delivery: string;
  wrote: boolean;
};

// Takes the person's arrival in hand for one delivery: null when nothing
// is owed, or when another delivery has it and has not died.
export async function claimArrival(q: Query): Promise<Claim | null> {
  return (
    (
      await q.query<Claim>(
        `update arrivals set delivery = gen_random_uuid(), delivering_at = now()
         where member_id = current_member()
           and (delivering_at is null or delivering_at < now() - interval '2 minutes')
         returning mode, words, delivery, wrote`,
      )
    ).rows[0] ?? null
  );
}

// Whether this delivery still has the arrival in hand: false once its
// lease lapsed and another took it.
export async function holdsArrival(q: Query, claim: Claim): Promise<boolean> {
  const { rowCount } = await q.query(
    "select 1 from arrivals where member_id = current_member() and delivery = $1",
    [claim.delivery],
  );
  return (rowCount ?? 0) > 0;
}

// The wish is in the person's file.
export async function arrivalWrote(q: Query, claim: Claim): Promise<void> {
  await q.query(
    "update arrivals set wrote = true where member_id = current_member() and delivery = $1",
    [claim.delivery],
  );
}

// A delivery that failed lets the arrival go, for the next try, unless
// another has taken it since.
export async function releaseArrival(q: Query, claim: Claim): Promise<void> {
  await q.query(
    `update arrivals set delivery = null, delivering_at = null
     where member_id = current_member() and delivery = $1`,
    [claim.delivery],
  );
}

// The computer has what it was owed, from the delivery that holds it.
export async function arrivalDelivered(q: Query, claim: Claim): Promise<void> {
  await q.query(
    "delete from arrivals where member_id = current_member() and delivery = $1",
    [claim.delivery],
  );
}
