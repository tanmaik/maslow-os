// The brain's part of the merge gate, run through the doors as the app role:
// each org sees only its own records, writes are idempotent, the vocabulary is
// open, events belong to the database, and an export imports back to the same
// answers. Returns true when every check passed.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { orgs } from "../packages/db/src/seed.ts";

const pg = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
)("pg");

export async function smokeBrain(stack) {
  process.env.DATABASE_URL = `postgres://app@127.0.0.1:${stack.pgPort}/postgres`;
  globalThis.__pool = undefined;
  const { asOrg, asPerson } = await import("../packages/db/src/index.ts");
  const me = (org) => (fn) =>
    asPerson(
      {
        orgId: org.id,
        personId: org.users[0].personId,
        userId: org.users[0].id,
      },
      fn,
    );
  const brain = await import("../packages/brain/src/index.ts");
  const { seeds, vocabulary } = await import("../packages/brain/src/seed.ts");

  let ok = true;
  const check = (label, pass, detail) => {
    console.log(
      `${pass ? "ok  " : "FAIL"}  brain: ${label.padEnd(34)} ${detail}`,
    );
    ok &&= pass;
  };
  const [acme, bakery] = orgs;
  const titles = (page) => page.records.map((r) => r.title).sort();
  try {
    await checks();
  } finally {
    await globalThis.__pool?.end();
    globalThis.__pool = undefined;
  }
  return ok;

  async function checks() {
    // A brand-new org, made the way sign-in makes one, starts with nothing and
    // refuses a kind nobody has defined.
    const { signIn } = await import("../packages/db/src/auth.ts");
    const fresh = await signIn({
      email: "fresh@brain.test",
      firstName: "Fresh",
      lastName: null,
    });
    const newcomer = await asPerson(fresh, async (q) => {
      const empty = await brain.catalog(q);
      const note = {
        kind: "note",
        layer: "source",
        source: "person",
        sourceRef: "first",
        title: "First note",
      };
      let refused = null;
      try {
        await brain.write(q, "smoke", { records: [note] });
      } catch (err) {
        refused = err;
      }
      await brain.defineKind(q, "smoke", {
        name: "note",
        description: "Something written down.",
      });
      const written = await brain.write(q, "smoke", { records: [note] });
      let noVerb = null;
      try {
        await brain.write(q, "smoke", {
          edges: [
            {
              from: { id: written.records[0] },
              verb: "cites",
              to: { id: written.records[0] },
              source: "smoke",
            },
          ],
        });
      } catch (err) {
        noVerb = err;
      }
      return { empty, refused, written, noVerb };
    });
    check(
      "a new org starts empty and refuses undefined kinds",
      newcomer.empty.kinds.length === 0 &&
        newcomer.empty.verbs.length === 0 &&
        newcomer.refused instanceof brain.Invalid &&
        newcomer.written.changed === 1 &&
        newcomer.noVerb instanceof brain.Invalid,
      `${newcomer.refused?.message ?? "not refused"}`,
    );

    // Isolation between orgs and between colleagues.
    for (const org of orgs) {
      const { page, vocab } = await me(org)(async (q) => ({
        page: await brain.read(q, { limit: 200 }),
        vocab: await brain.catalog(q),
      }));
      check(
        `${org.slug} sees its own records`,
        page.records.length === seeds[org.slug].records.length &&
          vocab.kinds.length === vocabulary.kinds.length,
        `${page.records.length} records, ${vocab.kinds.length} kinds`,
      );
    }
    const orgOnly = await asOrg(acme.id, (q) => brain.read(q));
    const colleague = await asPerson(
      {
        orgId: acme.id,
        personId: acme.users[1].personId,
        userId: acme.users[1].id,
      },
      async (q) => ({
        page: await brain.read(q),
        vocab: await brain.catalog(q),
      }),
    );
    check(
      "a colleague shares the vocabulary, not the records",
      orgOnly.records.length === 0 &&
        colleague.page.records.length === 0 &&
        colleague.vocab.kinds.length === vocabulary.kinds.length,
      `${colleague.page.records.length} records, ${colleague.vocab.kinds.length} kinds`,
    );

    // Search and the person filter.
    const rockets = await me(acme)((q) => brain.read(q, { query: "rocket" }));
    const noRockets = await me(bakery)((q) =>
      brain.read(q, { query: "rocket" }),
    );
    check(
      "search stays in the org",
      rockets.records.length >= 2 && noRockets.records.length === 0,
      `${rockets.records.length} in acme, ${noRockets.records.length} in the bakery`,
    );
    const about = await me(acme)(async (q) => {
      const people = await brain.read(q, { kind: "person" });
      const beep = people.records.find((r) => r.title === "Road Runner");
      return brain.read(q, { person: beep.id });
    });
    check(
      "person filter follows edges",
      about.records.length === 4,
      `${about.records.length} records about Road Runner`,
    );

    // Idempotent writes, optimistic edits.
    const note = {
      kind: "note",
      layer: "source",
      source: "smoke",
      sourceRef: "note-1",
      title: "Smoke note",
      body: "Written twice, stored once.",
    };
    const written = await me(acme)(async (q) => {
      const first = await brain.write(q, "smoke", { records: [note] });
      const again = await brain.write(q, "smoke", { records: [note] });
      const [after] = await brain.get(q, first.records);
      const changed = await brain.write(q, "smoke", {
        records: [{ ...note, body: "Changed." }],
      });
      const [afterChange] = await brain.get(q, changed.records);
      let conflict = null;
      try {
        await brain.edit(q, "smoke", after.id, after.version, {
          title: "Stale",
        });
      } catch (err) {
        conflict = err;
      }
      const edited = await brain.edit(
        q,
        "smoke",
        after.id,
        afterChange.version,
        {
          title: "Edited note",
        },
      );
      await brain.remove(q, "smoke", after.id);
      const hidden = await brain.read(q, { source: "smoke" });
      await brain.restore(q, "smoke", after.id);
      const back = await brain.read(q, { source: "smoke" });
      return {
        first,
        again,
        after,
        afterChange,
        conflict,
        edited,
        hidden,
        back,
      };
    });
    check(
      "same write twice, one record",
      written.first.records[0] === written.again.records[0] &&
        written.first.changed === 1 &&
        written.again.changed === 0 &&
        written.after.version === 1,
      `version ${written.after.version}`,
    );
    check(
      "a changed write bumps the version",
      written.afterChange.version === 2 &&
        written.afterChange.body === "Changed.",
      `version ${written.afterChange.version}`,
    );
    check(
      "a stale edit is a conflict",
      written.conflict instanceof brain.Conflict,
      written.conflict?.constructor.name ?? "no error",
    );
    check(
      "a current edit lands",
      written.edited.version === 3 && written.edited.title === "Edited note",
      `version ${written.edited.version}`,
    );
    check(
      "remove hides, restore brings back",
      written.hidden.records.length === 0 && written.back.records.length === 1,
      `${written.hidden.records.length} then ${written.back.records.length}`,
    );

    // The vocabulary is open.
    const lift = await me(acme)(async (q) => {
      let refused = null;
      try {
        await brain.defineKind(q, "smoke", { name: "lift", description: " " });
      } catch (err) {
        refused = err;
      }
      const a = await brain.defineKind(q, "smoke", {
        name: "lift",
        description: "One set of a barbell exercise, with weight and reps.",
      });
      const b = await brain.defineKind(q, "smoke", {
        name: "lift",
        description: "A different sentence that does not replace the first.",
      });
      const withField = await brain.defineKind(q, "smoke", {
        name: "lift",
        description: "Ignored: the kind exists.",
        properties: [
          {
            name: "weight",
            type: "number",
            description: "Kilograms on the bar.",
          },
          {
            name: "reps",
            type: "number",
            description: "Repetitions in the set.",
          },
        ],
      });
      const { kinds } = await brain.catalog(q);
      return { refused, a, b, withField, kinds };
    });
    check(
      "a kind needs a description",
      lift.refused instanceof Error,
      lift.refused ? "refused" : "accepted",
    );
    check(
      "defining a kind is idempotent",
      lift.a.id === lift.b.id &&
        lift.kinds.length === vocabulary.kinds.length + 1 &&
        lift.b.description === lift.a.description &&
        lift.withField.properties.length === 2,
      `${lift.kinds.length} kinds`,
    );

    // Declared fields.
    const forms = await me(acme)(async (q) => {
      const outcomes = [];
      const attempt = async (props) => {
        try {
          await brain.write(q, "smoke", {
            records: [
              {
                kind: "commitment",
                layer: "derived",
                source: "smoke",
                sourceRef: `c-${JSON.stringify(props)}`,
                title: "Attempt",
                props,
              },
            ],
          });
          outcomes.push("accepted");
        } catch (err) {
          outcomes.push(err instanceof brain.Invalid ? "refused" : "other");
        }
      };
      await attempt({ due: "next friday", status: "open" });
      await attempt({ due: "2026-09-12", status: "maybe" });
      await attempt({ status: "open" });
      await attempt({ due: "2026-09-12", status: "open", owner: "me" });
      await attempt({ due: "2026-09-12", status: "open" });

      const lifts = [102.5, 80, 130].map((weight, i) => ({
        kind: "lift",
        layer: "source",
        source: "smoke",
        sourceRef: `lift-${i}`,
        title: `Lift ${weight}`,
        props: { weight, reps: 5 },
      }));
      await brain.write(q, "smoke", { records: lifts });
      const heavy = await brain.read(q, {
        kind: "lift",
        where: [{ property: "weight", op: "gte", value: 100 }],
      });
      const ordered = [];
      let cursor = null;
      do {
        const page = await brain.read(q, {
          kind: "lift",
          orderBy: { property: "weight", direction: "desc" },
          limit: 1,
          cursor,
        });
        ordered.push(...page.records.map((r) => r.props.weight));
        cursor = page.cursor;
      } while (cursor);
      let unknown = null;
      try {
        await brain.read(q, {
          kind: "lift",
          where: [{ property: "sets", op: "eq", value: 1 }],
        });
      } catch (err) {
        unknown = err;
      }
      return { outcomes, heavy, ordered, unknown };
    });
    check(
      "a form refuses what does not fit",
      forms.outcomes.join(" ") === "refused refused refused refused accepted",
      forms.outcomes.join(" "),
    );
    check(
      "fields filter and sort across pages",
      forms.heavy.records.length === 2 &&
        forms.ordered.join(",") === "130,102.5,80" &&
        forms.unknown instanceof brain.Invalid,
      `${forms.heavy.records.length} heavy, order ${forms.ordered.join(",")}`,
    );

    // An edge carries strength and time.
    const detail = await me(acme)(async (q) => {
      const owes = (await brain.read(q, { kind: "person" })).records.find(
        (r) => r.title === "Wile Coyote",
      );
      const seeded = await brain.edgesOf(q, owes.id, "owes");
      const link = {
        from: { source: "seed", sourceRef: "person:wile" },
        verb: "owes",
        to: { source: "seed", sourceRef: "person:beep" },
        props: { what: "batch 7 rocket skates" },
        confidence: 0.8,
        occurredAt: "2026-08-28T15:04:00Z",
        source: "seed",
      };
      const same = await brain.write(q, "smoke", { edges: [link] });
      const stronger = await brain.write(q, "smoke", {
        edges: [{ ...link, confidence: 0.95 }],
      });
      const after = await brain.edgesOf(q, owes.id, "owes");
      return { seeded, same, stronger, after };
    });
    check(
      "an edge carries strength and time",
      detail.seeded.length === 1 &&
        detail.seeded[0].confidence === 0.8 &&
        detail.seeded[0].props.what === "batch 7 rocket skates" &&
        detail.seeded[0].occurredAt instanceof Date &&
        detail.same.edges === 0 &&
        detail.stronger.edges === 1 &&
        detail.after[0].confidence === 0.95,
      `${detail.seeded[0]?.confidence} then ${detail.after[0]?.confidence}`,
    );

    // An edge joins two records and can be taken back.
    const links = await me(acme)(async (q) => {
      const wile = { source: "seed", sourceRef: "person:wile" };
      let loop = null;
      try {
        await brain.write(q, "smoke", {
          edges: [{ from: wile, verb: "mentions", to: wile, source: "seed" }],
        });
      } catch (err) {
        loop = err;
      }
      const owes = (await brain.read(q, { kind: "person" })).records.find(
        (r) => r.title === "Wile Coyote",
      );
      const before = await brain.edgesOf(q, owes.id, "owes");
      await brain.unlink(q, "smoke:unlinker", before[0].id);
      const after = await brain.edgesOf(q, owes.id, "owes");
      const gone = await brain.history(q, { of: before[0].id });
      await brain.write(q, "smoke", {
        edges: [
          {
            from: wile,
            verb: "owes",
            to: { source: "seed", sourceRef: "person:beep" },
            confidence: 0.95,
            occurredAt: "2026-08-28T15:04:00Z",
            props: { what: "batch 7 rocket skates" },
            source: "seed",
          },
        ],
      });
      const whole = await brain.graph(q);
      const near = await brain.graph(q, [owes.id]);
      const nearIds = new Set(near.nodes.map((n) => n.id));
      const mine = (await brain.edgesOf(q, owes.id)).length;
      return {
        loop,
        before,
        after,
        gone,
        whole,
        near,
        nearIds,
        mine,
        me: owes.id,
      };
    });
    check(
      "an edge joins two records and unlinks",
      links.loop instanceof brain.Invalid &&
        links.before.length === 1 &&
        links.after.length === 0 &&
        links.gone[0].action === "deleted" &&
        links.gone[0].author === "smoke:unlinker" &&
        links.gone.filter((e) => e.author === "smoke:unlinker").length === 1 &&
        links.whole.edges.length === 9 &&
        links.near.nodes.length === 5 &&
        links.near.edges.filter(
          (e) => e.fromId === links.me || e.toId === links.me,
        ).length === links.mine &&
        links.near.edges.every(
          (e) => links.nearIds.has(e.fromId) && links.nearIds.has(e.toId),
        ),
      `self refused, ${links.before.length} then ${links.after.length}, logged ${links.gone.map((e) => e.action).join("+")} by ${links.gone[0].author}, graph ${links.whole.nodes.length}/${links.whole.edges.length}, near ${links.near.nodes.length}/${links.near.edges.length}`,
    );

    // Merging and unmerging.
    const merged = await me(acme)(async (q) => {
      const people = await brain.read(q, { kind: "person" });
      const beep = people.records.find((r) => r.title === "Road Runner");
      const mail = (await brain.read(q, { kind: "message" })).records[0];
      const {
        records: [dup],
      } = await brain.write(q, "smoke", {
        records: [
          {
            kind: "person",
            layer: "source",
            source: "smoke",
            sourceRef: "person:r-runner",
            title: "R. Runner",
            props: { emails: ["rr@acme-rockets.test"] },
          },
          {
            kind: "message",
            layer: "source",
            source: "smoke",
            sourceRef: "mail:rr-1",
            title: "Beep from the other address",
            body: "Sent from the R. Runner account.",
            occurredAt: new Date("2026-09-02T10:00:00Z"),
          },
        ],
        edges: [
          {
            from: { source: "smoke", sourceRef: "person:r-runner" },
            verb: "sent",
            to: { source: "smoke", sourceRef: "mail:rr-1" },
            source: "smoke",
          },
        ],
      });
      const before = await brain.read(q, { person: beep.id });
      let wrongKind = null;
      try {
        await brain.merge(q, "smoke", beep.id, mail.id);
      } catch (err) {
        wrongKind = err;
      }
      await brain.merge(q, "smoke", beep.id, dup);
      await brain.merge(q, "smoke", beep.id, dup);
      const after = await brain.read(q, { person: beep.id });
      const people2 = await brain.read(q, { kind: "person" });
      const [alias] = await brain.get(q, [dup]);
      const edges = await brain.edgesOf(q, beep.id);
      let restored = null;
      try {
        await brain.restore(q, "smoke", dup);
      } catch (err) {
        restored = err;
      }
      await brain.unmerge(q, "smoke", dup);
      const undone = await brain.read(q, { person: beep.id });
      await brain.merge(q, "smoke", beep.id, dup);
      return {
        beep,
        before,
        after,
        people2,
        alias,
        edges,
        wrongKind,
        restored,
        undone,
        dup,
      };
    });
    check(
      "merging makes two people one",
      merged.before.records.length === 4 &&
        merged.after.records.length === 5 &&
        merged.people2.records.every((r) => r.id !== merged.dup) &&
        merged.alias.mergedInto === merged.beep.id &&
        merged.edges.length === 6 &&
        merged.wrongKind instanceof brain.Invalid &&
        merged.restored instanceof brain.Invalid,
      `${merged.before.records.length} then ${merged.after.records.length} about Road Runner, ${merged.edges.length} edges`,
    );
    check(
      "unmerge puts it back",
      merged.undone.records.length === 4,
      `${merged.undone.records.length} about Road Runner`,
    );

    // A merge rewrites nothing, so merges chain and unmerge one link at a
    // time. A kind can be defined in the write that first uses it.
    const chain = await me(acme)(async (q) => {
      const {
        records: [a, b, c],
      } = await brain.write(q, "smoke", {
        kinds: [{ name: "alias", description: "A name someone also goes by." }],
        verbs: [{ name: "also_called", description: "Goes by this too." }],
        records: ["a", "b", "c"].map((n) => ({
          kind: "alias",
          layer: "source",
          source: "smoke",
          sourceRef: `alias:${n}`,
          title: n,
        })),
        edges: [
          {
            from: { source: "smoke", sourceRef: "alias:a" },
            verb: "also_called",
            to: { source: "smoke", sourceRef: "alias:c" },
            source: "smoke",
          },
        ],
      });
      await brain.merge(q, "smoke", b, a);
      await brain.merge(q, "smoke", c, b);
      const [aliasA] = await brain.get(q, [a]);
      const viaAlias = await brain.merge(q, "smoke", b, c).catch((e) => e);
      const deep = (await brain.edgesOf(q, c)).length;
      await brain.unmerge(q, "smoke", b);
      const got = await brain.get(q, [b, a]);
      const afterB = got.find((r) => r.id === b);
      const afterA = got.find((r) => r.id === a);
      const viaB = (await brain.edgesOf(q, b)).length;
      return { aliasA, viaAlias, deep, afterB, afterA, viaB };
    });
    check(
      "merges chain and rewrite nothing",
      chain.aliasA.mergedInto !== null &&
        chain.deep === 1 &&
        chain.viaAlias instanceof brain.Invalid &&
        chain.afterB.mergedInto === null &&
        chain.afterA.mergedInto === chain.afterB.id &&
        chain.viaB === 1,
      `a stays behind b, ${chain.deep} edge seen from c, ${chain.viaB} from b after unmerge`,
    );

    // The log.
    const events = await me(acme)(async (q) => {
      const log = await brain.changes(q, 0, 200);
      let denied = null;
      try {
        await q.query(
          "insert into events (org_id, subject, subject_id, action, author) values ($1, 'record', $2, 'created', 'smoke')",
          [acme.id, randomUUID()],
        );
      } catch (err) {
        denied = err;
      }
      return { log, denied };
    });
    check(
      "the log is written by triggers",
      events.log.length > 0 &&
        events.log.some(
          (e) => e.action === "updated" && e.subject === "record",
        ) &&
        events.log.some((e) => e.subject === "property"),
      `${events.log.length} events`,
    );
    check(
      "the app cannot write events",
      events.denied?.code === "42501",
      events.denied?.code ?? "allowed",
    );

    const leaked = await me(bakery)((q) => brain.get(q, [written.after.id]));
    check(
      "ids do not cross orgs",
      leaked.length === 0,
      `${leaked.length} rows`,
    );

    // Export and import.
    const owner = new pg.Client({
      connectionString: `postgres://postgres@127.0.0.1:${stack.pgPort}/postgres`,
    });
    await owner.connect();
    const target = randomUUID();
    const targetPerson = randomUUID();
    try {
      await owner.query("begin");
      await owner.query(
        "insert into orgs (id, slug, name, principal_id) values ($1, 'export-target', 'Export Target', $2)",
        [target, targetPerson],
      );
      await owner.query(
        "insert into people (id, email, first_name) values ($1, 'someone@export-target.test', 'Someone')",
        [targetPerson],
      );
      await owner.query(
        "insert into users (id, org_id, person_id, email, first_name, role) values ($1, $2, $1, 'someone@export-target.test', 'Someone', 'owner')",
        [targetPerson, target],
      );
      await owner.query("commit");
    } finally {
      await owner.end();
    }
    const exported = await me(acme)((q) => brain.exportBrain(q));
    const imported = await asPerson(
      { orgId: target, personId: targetPerson, userId: targetPerson },
      async (q) => {
        const counts = await brain.importBrain(q, "smoke", exported);
        const twice = await brain.importBrain(q, "smoke", exported);
        const beep = (await brain.read(q, { kind: "person" })).records.find(
          (r) => r.title === "Road Runner",
        );
        return {
          counts,
          twice,
          all: await brain.read(q, { limit: 200 }),
          rockets: await brain.read(q, { query: "rocket" }),
          vocab: await brain.catalog(q),
          aboutBeep: await brain.read(q, { person: beep.id }),
        };
      },
    );
    const before = await me(acme)((q) => brain.read(q, { limit: 200 }));
    const vocab = await me(acme)((q) => brain.catalog(q));
    check(
      "export imports to the same answers",
      JSON.stringify(titles(imported.all)) === JSON.stringify(titles(before)) &&
        JSON.stringify(titles(imported.rockets)) ===
          JSON.stringify(titles(rockets)) &&
        imported.vocab.kinds.length === vocab.kinds.length &&
        imported.vocab.kinds.find((k) => k.name === "lift").properties
          .length === 2 &&
        imported.counts.merges === 2 &&
        imported.aboutBeep.records.length === 5,
      `${imported.all.records.length} records, ${imported.counts.edges} edges, ${imported.counts.properties} fields, ${imported.counts.merges} merges`,
    );
    check(
      "importing twice adds nothing",
      imported.twice.records === 0 &&
        imported.twice.edges === 0 &&
        imported.twice.kinds === 0 &&
        imported.twice.properties === 0 &&
        imported.twice.merges === 0,
      `${imported.twice.records} records, ${imported.twice.edges} edges`,
    );
  }
}
