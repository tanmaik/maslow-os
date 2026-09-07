import pg from "pg";

import { defineType, type TypeDefinition } from "./catalog.ts";
import type { EdgeInput, RecordInput } from "./types.ts";
import { write } from "./write.ts";

// The vocabulary the seeded records use. A real brain starts with none and
// a person's vocabulary is whatever they define in it.
export const vocabulary: TypeDefinition[] = [
  { name: "person", properties: [{ name: "emails", datatype: "list" }] },
  { name: "message" },
  { name: "event" },
  {
    name: "commitment",
    properties: [
      { name: "due", datatype: "date", required: true },
      {
        name: "status",
        datatype: "enum",
        options: ["open", "done", "dropped"],
        required: true,
      },
    ],
  },
  { name: "note" },
];

const ref = (source: string, sourceRef: string) => ({ source, sourceRef });
const at = (iso: string) => new Date(iso);

// Three brains that could never be mistaken for one another, keyed by org
// slug, so a record under the wrong org is obvious at a glance.
export const seeds: Record<
  string,
  { records: RecordInput[]; edges: EdgeInput[] }
> = {
  "acme-rockets": {
    records: [
      {
        type: "person",
        source: "seed",
        sourceRef: "person:wile",
        title: "Wile Coyote",
        props: { emails: ["wile@acme-rockets.test"] },
      },
      {
        type: "person",
        source: "seed",
        sourceRef: "person:beep",
        title: "Road Runner",
        props: { emails: ["beep@acme-rockets.test"] },
      },
      {
        type: "message",
        source: "seed",
        sourceRef: "mail:acme-1",
        title: "Rocket skates, batch 7",
        body: "Road Runner, the batch 7 rocket skates ship Friday. Do not test them on the mesa road again.",
        occurredAt: at("2026-08-28T15:04:00Z"),
      },
      {
        type: "message",
        source: "seed",
        sourceRef: "mail:acme-2",
        title: "Re: Rocket skates, batch 7",
        body: "Meep meep. Friday works. Leave them by the cactus.",
        occurredAt: at("2026-08-28T16:10:00Z"),
      },
      {
        type: "event",
        source: "seed",
        sourceRef: "cal:acme-1",
        title: "Rocket skate test on the mesa",
        body: "Bring the helmet.",
        occurredAt: at("2026-09-05T09:00:00Z"),
      },
      {
        type: "commitment",
        source: "seed",
        sourceRef: "derived:acme-1",
        title: "Ship batch 7 rocket skates by Friday",
        body: "Wile told Road Runner the batch ships Friday.",
        props: { due: "2026-09-04", status: "open" },
        occurredAt: at("2026-09-04T00:00:00Z"),
        confidence: 0.8,
      },
    ],
    edges: [
      {
        from: ref("seed", "person:wile"),
        verb: "sent",
        to: ref("seed", "mail:acme-1"),
      },
      {
        from: ref("seed", "person:beep"),
        verb: "received",
        to: ref("seed", "mail:acme-1"),
      },
      {
        from: ref("seed", "mail:acme-1"),
        verb: "mentions",
        to: ref("seed", "person:beep"),
      },
      {
        from: ref("seed", "person:beep"),
        verb: "sent",
        to: ref("seed", "mail:acme-2"),
      },
      {
        from: ref("seed", "person:wile"),
        verb: "received",
        to: ref("seed", "mail:acme-2"),
      },
      {
        from: ref("seed", "person:wile"),
        verb: "attended",
        to: ref("seed", "cal:acme-1"),
      },
      {
        from: ref("seed", "person:beep"),
        verb: "attended",
        to: ref("seed", "cal:acme-1"),
      },
      {
        from: ref("seed", "derived:acme-1"),
        verb: "rests_on",
        to: ref("seed", "mail:acme-1"),
      },
      {
        from: ref("seed", "person:wile"),
        verb: "owes",
        to: ref("seed", "person:beep"),
        props: { what: "batch 7 rocket skates" },
        confidence: 0.8,
        occurredAt: at("2026-08-28T15:04:00Z"),
      },
    ],
  },
  "blue-whale-bakery": {
    records: [
      {
        type: "person",
        source: "seed",
        sourceRef: "person:marge",
        title: "Marge Crumb",
        props: { emails: ["marge@bluewhale.test"] },
      },
      {
        type: "person",
        source: "seed",
        sourceRef: "person:otto",
        title: "Otto Loaf",
        props: { emails: ["otto@bluewhale.test"] },
      },
      {
        type: "message",
        source: "seed",
        sourceRef: "mail:bakery-1",
        title: "Sourdough for Saturday's market",
        body: "Otto, we need forty loaves for the farmers market stall on Saturday. Start the levain Thursday.",
        occurredAt: at("2026-09-01T08:30:00Z"),
      },
      {
        type: "message",
        source: "seed",
        sourceRef: "mail:bakery-2",
        title: "Re: Sourdough for Saturday's market",
        body: "Levain is on. Forty loaves, plus rye if the oven cooperates.",
        occurredAt: at("2026-09-01T09:12:00Z"),
      },
      {
        type: "event",
        source: "seed",
        sourceRef: "cal:bakery-1",
        title: "Farmers market stall",
        body: "Set up by seven.",
        occurredAt: at("2026-09-06T07:00:00Z"),
      },
      {
        type: "commitment",
        source: "seed",
        sourceRef: "derived:bakery-1",
        title: "Bake forty sourdough loaves for Saturday's market",
        body: "Marge asked Otto for forty loaves; Otto agreed.",
        props: { due: "2026-09-06", status: "open" },
        occurredAt: at("2026-09-06T00:00:00Z"),
        confidence: 0.9,
      },
    ],
    edges: [
      {
        from: ref("seed", "person:marge"),
        verb: "sent",
        to: ref("seed", "mail:bakery-1"),
      },
      {
        from: ref("seed", "person:otto"),
        verb: "received",
        to: ref("seed", "mail:bakery-1"),
      },
      {
        from: ref("seed", "person:otto"),
        verb: "sent",
        to: ref("seed", "mail:bakery-2"),
      },
      {
        from: ref("seed", "person:marge"),
        verb: "received",
        to: ref("seed", "mail:bakery-2"),
      },
      {
        from: ref("seed", "person:otto"),
        verb: "attended",
        to: ref("seed", "cal:bakery-1"),
      },
      {
        from: ref("seed", "derived:bakery-1"),
        verb: "rests_on",
        to: ref("seed", "mail:bakery-1"),
      },
      {
        from: ref("seed", "derived:bakery-1"),
        verb: "rests_on",
        to: ref("seed", "mail:bakery-2"),
      },
      {
        from: ref("seed", "person:otto"),
        verb: "owes",
        to: ref("seed", "person:marge"),
      },
    ],
  },
  "chartreuse-observatory": {
    records: [
      {
        type: "person",
        source: "seed",
        sourceRef: "person:vera",
        title: "Vera Nebula",
        props: { emails: ["vera@chartreuse.test"] },
      },
      {
        type: "message",
        source: "seed",
        sourceRef: "mail:observatory-1",
        title: "Comet observation window",
        body: "The comet is brightest between the 9th and the 12th. Requesting the big telescope both nights.",
        occurredAt: at("2026-09-02T21:40:00Z"),
      },
      {
        type: "event",
        source: "seed",
        sourceRef: "cal:observatory-1",
        title: "Comet observation night",
        body: "Dome opens at ten.",
        occurredAt: at("2026-09-10T22:00:00Z"),
      },
      {
        type: "commitment",
        source: "seed",
        sourceRef: "derived:observatory-1",
        title: "Send the comet observation log to the journal by the 15th",
        body: "Vera promised the log after the second night.",
        props: { due: "2026-09-15", status: "open" },
        occurredAt: at("2026-09-15T00:00:00Z"),
        confidence: 0.6,
      },
    ],
    edges: [
      {
        from: ref("seed", "person:vera"),
        verb: "sent",
        to: ref("seed", "mail:observatory-1"),
      },
      {
        from: ref("seed", "person:vera"),
        verb: "attended",
        to: ref("seed", "cal:observatory-1"),
      },
      {
        from: ref("seed", "derived:observatory-1"),
        verb: "rests_on",
        to: ref("seed", "mail:observatory-1"),
      },
    ],
  },
};

// Gives each seeded org's first person the starter vocabulary and the
// records; a colleague starts with none. Idempotent, like the doors it goes
// through.
export async function seedBrain(
  url: string,
  orgs: readonly {
    id: string;
    slug: string;
    users: readonly { id: string }[];
  }[],
): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const org of orgs) {
      await client.query("begin");
      try {
        await client.query("select set_config('app.org_id', $1, true)", [
          org.id,
        ]);
        await client.query("select set_config('app.member_id', $1, true)", [
          org.users[0]!.id,
        ]);
        await client.query("select set_config('app.author', 'seed', true)");
        for (const t of vocabulary) await defineType(client, t);
        const home = seeds[org.slug];
        if (home) await write(client, home);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}
