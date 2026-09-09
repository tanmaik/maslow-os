// The brain's part of the merge gate, run through the doors as the app role:
// each person sees only their own records and vocabulary until a share says
// otherwise, writes are idempotent, events belong to the database, and an
// export imports back to the same answers. Returns true when every check
// passed.
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
  const groupsDoor = await import("../packages/db/src/groups.ts");
  // A member of an org as a principal, the way a session names one.
  const member = (org, i) => ({
    orgId: org.id,
    personId: org.users[i].personId,
    userId: org.users[i].id,
    role: i === 0 ? "owner" : "member",
  });

  let ok = true;
  const check = (label, pass, detail) => {
    console.log(
      `${pass ? "ok  " : "FAIL"}  brain: ${label.padEnd(34)} ${detail}`,
    );
    ok &&= pass;
  };
  // What a door said to a call: allowed, or the refusal's name.
  const attempt = async (fn) => {
    try {
      await fn();
      return "allowed";
    } catch (err) {
      return err.constructor.name;
    }
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
    // refuses a type nobody has defined.
    const { signIn } = await import("../packages/db/src/auth.ts");
    const fresh = await signIn({
      email: "fresh@brain.test",
      firstName: "Fresh",
      lastName: null,
    });
    const newcomer = await asPerson(fresh, async (q) => {
      const empty = await brain.catalog(q);
      const note = {
        type: "note",
        source: "person",
        sourceRef: "first",
        title: "First note",
      };
      let refused = null;
      try {
        await brain.write(q, { records: [note] });
      } catch (err) {
        refused = err;
      }
      await brain.defineType(q, { name: "note" });
      const written = await brain.write(q, { records: [note] });
      let loop = null;
      try {
        await brain.write(q, {
          edges: [
            {
              from: { id: written.records[0] },
              verb: "cites",
              to: { id: written.records[0] },
            },
          ],
        });
      } catch (err) {
        loop = err;
      }
      return { empty, refused, written, loop };
    });
    check(
      "a new org starts empty and refuses undefined types",
      newcomer.empty.types.length === 0 &&
        newcomer.refused instanceof brain.Invalid &&
        newcomer.written.changed === 1 &&
        newcomer.loop instanceof brain.Invalid,
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
          vocab.types.length === vocabulary.length,
        `${page.records.length} records, ${vocab.types.length} types`,
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
      "a colleague sees neither the records nor the vocabulary, and both see the org",
      orgOnly.records.length === 0 &&
        colleague.page.records.length === 0 &&
        colleague.vocab.types.length === 0 &&
        acme.users.every((u) =>
          colleague.vocab.people.some((p) => p.id === u.id),
        ),
      `${colleague.page.records.length} records, ${colleague.vocab.types.length} types, ${colleague.vocab.people.length} people`,
    );

    // A type is shared whole with the org, or opened one record at a time;
    // either way it appears in the colleague's catalog as its owner's, and
    // goes when the share does.
    const roadRunner = (fn) => asPerson(member(acme, 1), fn);
    const opened = await me(acme)(async (q) => {
      const commitment = (await brain.catalog(q)).types.find(
        (k) => k.name === "commitment",
      );
      const beep = (await brain.read(q, { type: "person" })).records.find(
        (r) => r.title === "Road Runner",
      );
      await brain.share(
        q,
        { type: commitment.id },
        { who: "everyone" },
        "view",
      );
      await brain.share(
        q,
        { record: beep.id },
        { who: "member", id: acme.users[1].id },
        "view",
      );
      return {
        commitment,
        beep,
        commitments: (await brain.read(q, { type: "commitment" })).records
          .length,
        shares: await brain.sharesOf(q, { type: commitment.id }),
      };
    });
    const seen = await roadRunner(async (q) => {
      const vocab = await brain.catalog(q);
      const commitment = vocab.types.find((k) => k.name === "commitment");
      return {
        vocab,
        commitment,
        person: vocab.types.find((k) => k.name === "person"),
        theirs: await brain.read(q, {
          type: "commitment",
          owner: acme.users[0].id,
        }),
        unnamed: await brain.read(q, { type: "commitment" }),
        beep: (await brain.get(q, [opened.beep.id]))[0],
        waiting: await brain.waiting(q),
        people: await brain.read(q, {
          type: "person",
          owner: acme.users[0].id,
        }),
        note: await brain.defineType(q, { name: "note" }),
        steal: await attempt(() =>
          brain.share(q, { type: commitment.id }, { who: "everyone" }, "view"),
        ),
      };
    });
    check(
      "a type shared with the org opens every record of it",
      seen.commitment?.own === false &&
        seen.commitment.ownerId === acme.users[0].id &&
        seen.commitment.properties.length === 2 &&
        seen.theirs.records.length === opened.commitments &&
        opened.commitments > 0 &&
        seen.unnamed.records.length === opened.commitments &&
        opened.shares.length === 1 &&
        opened.shares[0].on.type === opened.commitment.id,
      `${seen.theirs.records.length} of Wile's commitments, ${seen.unnamed.records.length} named without an owner, ${seen.commitment?.properties.length} fields`,
    );
    check(
      "a record shared alone opens it and its type, and no other record of it, and waits on nobody",
      seen.beep?.title === "Road Runner" &&
        seen.waiting === 0 &&
        seen.person?.own === false &&
        seen.person.properties.some((f) => f.name === "emails") &&
        seen.people.records.length === 1 &&
        seen.people.records[0].id === opened.beep.id,
      `${seen.beep?.title ?? "hidden"}, type ${seen.person ? "listed" : "missing"}, ${seen.people.records.length} of Wile's people in view, ${seen.waiting} waiting`,
    );
    const wileNote = (await me(acme)((q) => brain.catalog(q))).types.find(
      (k) => k.name === "note",
    );
    check(
      "two people each have a note type of their own",
      seen.note.ownerId === acme.users[1].id &&
        seen.note.own === true &&
        wileNote?.ownerId === acme.users[0].id &&
        wileNote.own === true &&
        seen.steal === "Forbidden",
      `Road Runner's and Wile's; sharing another's type ${seen.steal}`,
    );
    await me(acme)(async (q) => {
      await brain.unshare(
        q,
        { type: opened.commitment.id },
        { who: "everyone" },
      );
      await brain.unshare(
        q,
        { record: opened.beep.id },
        { who: "member", id: acme.users[1].id },
      );
    });
    const closed = await roadRunner(async (q) => ({
      types: (await brain.catalog(q)).types.map((t) => t.name),
      beep: (await brain.get(q, [opened.beep.id])).length,
    }));
    check(
      "unsharing takes the type and the record away",
      closed.types.join(",") === "note" && closed.beep === 0,
      `${closed.types.join(", ")} left, ${closed.beep} records`,
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
      const people = await brain.read(q, { type: "person" });
      const beep = people.records.find((r) => r.title === "Road Runner");
      return brain.read(q, { person: beep.id });
    });
    check(
      "person filter follows edges",
      about.records.length === 4,
      `${about.records.length} records about Road Runner`,
    );

    // Idempotent writes and edits.
    const note = {
      type: "note",
      source: "smoke",
      sourceRef: "note-1",
      title: "Smoke note",
      body: "Written twice, stored once.",
    };
    const written = await me(acme)(async (q) => {
      const first = await brain.write(q, { records: [note] });
      const again = await brain.write(q, { records: [note] });
      const [after] = await brain.get(q, first.records);
      const changed = await brain.write(q, {
        records: [{ ...note, body: "Changed." }],
      });
      const [afterChange] = await brain.get(q, changed.records);
      const edited = await brain.edit(q, after.id, { title: "Edited note" });
      await brain.remove(q, after.id);
      const [hidden] = await brain.get(q, [after.id]);
      await brain.restore(q, after.id);
      const [back] = await brain.get(q, [after.id]);
      return {
        first,
        again,
        after,
        changed,
        afterChange,
        edited,
        hidden,
        back,
      };
    });
    check(
      "same write twice, one record",
      written.first.records[0] === written.again.records[0] &&
        written.first.changed === 1 &&
        written.again.changed === 0,
      `${written.first.changed} then ${written.again.changed} changed`,
    );
    check(
      "a changed write lands and is a change",
      written.changed.changed === 1 && written.afterChange.body === "Changed.",
      `${written.changed.changed} changed, body ${JSON.stringify(written.afterChange.body)}`,
    );
    check(
      "an edit lands",
      written.edited.title === "Edited note",
      written.edited.title,
    );
    check(
      "remove hides, restore brings back",
      written.hidden.deletedAt !== null && written.back.deletedAt === null,
      `hidden ${written.hidden.deletedAt !== null}, back ${written.back.deletedAt === null}`,
    );

    // The vocabulary is open.
    const lift = await me(acme)(async (q) => {
      let refused = null;
      try {
        await brain.defineType(q, { name: " " });
      } catch (err) {
        refused = err;
      }
      const a = await brain.defineType(q, { name: "lift" });
      const b = await brain.defineType(q, { name: "lift" });
      const withField = await brain.defineType(q, {
        name: "lift",
        properties: [
          { name: "weight", datatype: "number" },
          { name: "reps", datatype: "number" },
        ],
      });
      let badType = null;
      try {
        await brain.defineProperty(q, "lift", {
          name: "tempo",
          datatype: "tempo",
        });
      } catch (err) {
        badType = err;
      }
      const { types } = await brain.catalog(q);
      return { refused, badType, a, b, withField, types };
    });
    check(
      "a type needs a name, and a field a datatype",
      lift.refused instanceof brain.Invalid &&
        lift.badType instanceof brain.Invalid,
      `${lift.refused ? "refused" : "accepted"}, ${lift.badType instanceof brain.Invalid ? "refused" : "accepted"}`,
    );
    check(
      "defining a type is idempotent",
      lift.a.id === lift.b.id &&
        lift.types.length === vocabulary.length + 1 &&
        lift.withField.properties.length === 2,
      `${lift.types.length} types`,
    );

    // Declared fields.
    const forms = await me(acme)(async (q) => {
      const outcomes = [];
      const attempt = async (props) => {
        try {
          await brain.write(q, {
            records: [
              {
                type: "commitment",
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
        type: "lift",
        source: "smoke",
        sourceRef: `lift-${i}`,
        title: `Lift ${weight}`,
        props: { weight, reps: 5 },
      }));
      await brain.write(q, { records: lifts });
      const heavy = await brain.read(q, {
        type: "lift",
        where: [{ property: "weight", op: "gte", value: 100 }],
      });
      const ordered = [];
      let cursor = null;
      do {
        const page = await brain.read(q, {
          type: "lift",
          orderBy: { property: "weight", direction: "desc" },
          limit: 1,
          cursor,
        });
        ordered.push(...page.records.map((r) => r.props.weight));
        cursor = page.cursor;
      } while (cursor);
      const paged = [];
      cursor = null;
      do {
        const page = await brain.read(q, { type: "lift", limit: 1, cursor });
        paged.push(...page.records.map((r) => r.title));
        cursor = page.cursor;
      } while (cursor);
      let unknown = null;
      try {
        await brain.read(q, {
          type: "lift",
          where: [{ property: "sets", op: "eq", value: 1 }],
        });
      } catch (err) {
        unknown = err;
      }
      return { outcomes, heavy, ordered, paged, unknown };
    });

    // A list field is searched for one of its values; the person type's
    // emails are one.
    const wile = await me(acme)((q) =>
      brain.read(q, {
        type: "person",
        where: [
          {
            property: "emails",
            op: "contains",
            value: "wile@acme-rockets.test",
          },
        ],
      }),
    );
    check(
      "a list field is searched by one value",
      wile.records.length === 1 && wile.records[0].title === "Wile Coyote",
      wile.records.map((r) => r.title).join(",") || "nothing",
    );
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
    check(
      "records written in one call page without a gap",
      forms.paged.length === 3,
      `${forms.paged.length} of 3`,
    );

    // An edge carries strength and time.
    const detail = await me(acme)(async (q) => {
      const owes = (await brain.read(q, { type: "person" })).records.find(
        (r) => r.title === "Wile Coyote",
      );
      const seeded = await brain.edgesOf(q, owes.id, "owes");
      const link = {
        from: { source: "seed", sourceRef: "person:wile" },
        verb: "owes",
        to: { source: "seed", sourceRef: "person:beep" },
        confidence: 0.8,
        occurredAt: "2026-08-28T15:04:00Z",
      };
      const same = await brain.write(q, { edges: [link] });
      const stronger = await brain.write(q, {
        edges: [{ ...link, confidence: 0.95 }],
      });
      const after = await brain.edgesOf(q, owes.id, "owes");
      return { seeded, same, stronger, after };
    });
    check(
      "an edge carries strength and time",
      detail.seeded.length === 1 &&
        detail.seeded[0].confidence === 0.8 &&
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
        await brain.write(q, {
          edges: [{ from: wile, verb: "mentions", to: wile }],
        });
      } catch (err) {
        loop = err;
      }
      const owes = (await brain.read(q, { type: "person" })).records.find(
        (r) => r.title === "Wile Coyote",
      );
      const before = await brain.edgesOf(q, owes.id, "owes");
      await asPerson({ ...member(acme, 0), client: "unlinker" }, (u) =>
        brain.unlink(u, before[0].id),
      );
      const after = await brain.edgesOf(q, owes.id, "owes");
      const gone = await brain.history(q, { of: before[0].id });
      await brain.write(q, {
        edges: [
          {
            from: wile,
            verb: "owes",
            to: { source: "seed", sourceRef: "person:beep" },
            confidence: 0.95,
            occurredAt: "2026-08-28T15:04:00Z",
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
        links.gone[0].author === "model:unlinker" &&
        links.gone.filter((e) => e.author === "model:unlinker").length === 1 &&
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

    // A link shows only while both its ends are here.
    const ghosts = await me(acme)(async (q) => {
      const a = { source: "smoke", sourceRef: "ghost:a" };
      const b = { source: "smoke", sourceRef: "ghost:b" };
      const made = await brain.write(q, {
        records: [
          { type: "note", ...a, title: "A ghost" },
          { type: "note", ...b, title: "Another ghost" },
        ],
        edges: [{ from: a, verb: "haunts", to: b }],
      });
      const [a1, b1] = made.records;
      await brain.remove(q, b1);
      const dangling = (await brain.edgesOf(q, a1)).length;
      await brain.remove(q, a1);
      await brain.restore(q, a1);
      await brain.restore(q, b1);
      const shown = (await brain.edgesOf(q, a1)).length;
      return { dangling, shown };
    });
    check(
      "a link shows only while both ends are here",
      ghosts.dangling === 0 && ghosts.shown === 1,
      `links to a removed record ${ghosts.dangling}, both back with ${ghosts.shown} link`,
    );

    // A verb renamed follows every edge that carries it, hidden ones too.
    const renamed = await me(acme)(async (q) => {
      const wile = (await brain.read(q, { type: "person" })).records.find(
        (r) => r.title === "Wile Coyote",
      );
      const [edge] = await brain.edgesOf(q, wile.id, "owes");
      await brain.unlink(q, edge.id);
      const moved = await brain.renameVerb(q, "owes", "owes_to");
      await brain.restoreEdge(q, edge.id);
      const after = (await brain.edgesOf(q, wile.id, "owes_to")).length;
      await brain.renameVerb(q, "owes_to", "owes");
      return { moved, after };
    });
    check(
      "a renamed verb follows hidden edges too",
      renamed.moved === 1 && renamed.after === 1,
      `${renamed.moved} edge renamed, ${renamed.after} back under the new verb`,
    );

    // Two records already joined under the new name keep one edge, and an
    // edge may name a record written in the same call by its position.
    const collided = await me(acme)(async (q) => {
      const {
        records: [a, b],
      } = await brain.write(q, {
        types: [{ name: "pin" }],
        records: [
          { type: "pin", title: "Pin a" },
          { type: "pin", title: "Pin b" },
        ],
        edges: [
          { from: { index: 0 }, verb: "near", to: { index: 1 } },
          { from: { index: 0 }, verb: "beside", to: { index: 1 } },
        ],
      });
      const [beside] = await brain.edgesOf(q, a, "beside");
      await brain.unlink(q, beside.id);
      const moved = await brain.renameVerb(q, "near", "beside");
      const live = await brain.edgesOf(q, a);
      const outOfRange = await attempt(() =>
        brain.write(q, {
          edges: [{ from: { index: 0 }, verb: "near", to: { id: b } }],
        }),
      );
      return { moved, live, outOfRange };
    });
    check(
      "a rename onto a pair already joined keeps one edge; edges name records by position",
      collided.moved === 0 &&
        collided.live.length === 1 &&
        collided.live[0].verb === "beside" &&
        collided.outOfRange === "Invalid",
      `${collided.moved} renamed, ${collided.live.map((e) => e.verb).join(",")} live, out of range ${collided.outOfRange}`,
    );

    // Merging and unmerging.
    const merged = await me(acme)(async (q) => {
      const people = await brain.read(q, { type: "person" });
      const beep = people.records.find((r) => r.title === "Road Runner");
      const mail = (await brain.read(q, { type: "message" })).records[0];
      const {
        records: [dup],
      } = await brain.write(q, {
        records: [
          {
            type: "person",
            source: "smoke",
            sourceRef: "person:r-runner",
            title: "R. Runner",
            props: { emails: ["rr@acme-rockets.test"] },
          },
          {
            type: "message",
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
          },
        ],
      });
      const before = await brain.read(q, { person: beep.id });
      let wrongType = null;
      try {
        await brain.merge(q, beep.id, mail.id);
      } catch (err) {
        wrongType = err;
      }
      await brain.merge(q, beep.id, dup);
      await brain.merge(q, beep.id, dup);
      const after = await brain.read(q, { person: beep.id });
      const people2 = await brain.read(q, { type: "person" });
      const [alias] = await brain.get(q, [dup]);
      const edges = await brain.edgesOf(q, beep.id);
      let restored = null;
      try {
        await brain.restore(q, dup);
      } catch (err) {
        restored = err;
      }
      await brain.unmerge(q, dup);
      const undone = await brain.read(q, { person: beep.id });
      await brain.merge(q, beep.id, dup);
      return {
        beep,
        before,
        after,
        people2,
        alias,
        edges,
        wrongType,
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
        merged.wrongType instanceof brain.Invalid &&
        merged.restored instanceof brain.Invalid,
      `${merged.before.records.length} then ${merged.after.records.length} about Road Runner, ${merged.edges.length} edges`,
    );
    check(
      "unmerge puts it back",
      merged.undone.records.length === 4,
      `${merged.undone.records.length} about Road Runner`,
    );

    // A merge rewrites nothing, so merges chain and unmerge one link at a
    // time. A type can be defined in the write that first uses it.
    const chain = await me(acme)(async (q) => {
      const {
        records: [a, b, c],
      } = await brain.write(q, {
        types: [{ name: "alias" }],
        records: ["a", "b", "c"].map((n) => ({
          type: "alias",
          source: "smoke",
          sourceRef: `alias:${n}`,
          title: n,
        })),
        edges: [
          {
            from: { source: "smoke", sourceRef: "alias:a" },
            verb: "also_called",
            to: { source: "smoke", sourceRef: "alias:c" },
          },
        ],
      });
      await brain.merge(q, b, a);
      await brain.merge(q, c, b);
      const [aliasA] = await brain.get(q, [a]);
      const viaAlias = await brain.merge(q, b, c).catch((e) => e);
      const deep = (await brain.edgesOf(q, c)).length;
      await brain.unmerge(q, b);
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
      const log = await brain.history(q, { limit: 200 });
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

    // Sharing inside an org made for it: an owner, an editor and a viewer
    // admitted by invitation, and a stranger in an org of their own.
    const { invite } = await import("../packages/db/src/auth.ts");
    const admit = (email, firstName) =>
      signIn({ email, firstName, lastName: null });
    const marge = await admit("owner@sharing.test", "Marge");
    await invite(marge, "editor@sharing.test");
    await invite(marge, "viewer@sharing.test");
    const otto = await admit("editor@sharing.test", "Otto");
    const pim = await admit("viewer@sharing.test", "Pim");
    const ottoElsewhere = await admit("stranger@sharing.test", "Stranger");
    const as = (who) => (fn) => asPerson(who, fn);
    const noteOf = (ref, title) => ({
      type: "note",
      source: "smoke",
      sourceRef: ref,
      title,
    });
    // Each of them defines a note of their own: a record is of its writer's
    // type.
    const words = { types: [{ name: "note" }] };
    for (const who of [otto, pim]) {
      await as(who)((q) => brain.write(q, words));
    }
    const [privateNote] = (
      await as(marge)((q) =>
        brain.write(q, {
          ...words,
          records: [noteOf("share-1", "Levain log")],
        }),
      )
    ).records;
    const unseen = await as(otto)(async (q) => ({
      got: await brain.get(q, [privateNote]),
      shared: await brain.read(q, { scope: "shared" }),
    }));
    check(
      "a colleague sees nothing until shared",
      unseen.got.length === 0 && unseen.shared.records.length === 0,
      `${unseen.got.length} records`,
    );

    await as(marge)((q) =>
      brain.share(
        q,
        { record: privateNote },
        {
          who: "member",
          id: otto.userId,
        },
        "view",
      ),
    );
    const viewer = await as(otto)(async (q) => {
      const [r] = await brain.get(q, [privateNote]);
      return {
        r,
        shared: (await brain.read(q, { scope: "shared" })).records.length,
        mine: (await brain.read(q, { scope: "mine" })).records.length,
        edit: await attempt(() =>
          brain.edit(q, privateNote, { title: "Mine now" }),
        ),
        share: await attempt(() =>
          brain.share(q, { record: privateNote }, { who: "everyone" }, "view"),
        ),
        history: (await brain.history(q, { of: privateNote })).length,
      };
    });
    check(
      "view sees, and only sees",
      viewer.r?.access === "view" &&
        viewer.r.ownerId === marge.userId &&
        viewer.shared === 1 &&
        viewer.mine === 0 &&
        viewer.edit === "Forbidden" &&
        viewer.share === "Forbidden" &&
        viewer.history >= 1,
      `access ${viewer.r?.access}, edit ${viewer.edit}, share ${viewer.share}`,
    );

    await as(marge)((q) =>
      brain.share(
        q,
        { record: privateNote },
        {
          who: "member",
          id: otto.userId,
        },
        "edit",
      ),
    );
    const editor = await as(otto)(async (q) => {
      const [r] = await brain.get(q, [privateNote]);
      const edited = await brain.edit(q, privateNote, {
        title: "Levain log, revised",
      });
      const [own] = (
        await brain.write(q, {
          records: [noteOf("otto-1", "Otto's addendum")],
        })
      ).records;
      const link = await attempt(() =>
        brain.write(q, {
          edges: [
            {
              from: { id: own },
              verb: "mentions",
              to: { id: privateNote },
            },
          ],
        }),
      );
      return {
        edited,
        link,
        remove: await attempt(() => brain.remove(q, privateNote)),
      };
    });
    check(
      "edit changes and links, but does not remove",
      editor.edited.title === "Levain log, revised" &&
        editor.edited.access === "edit" &&
        editor.link === "allowed" &&
        editor.remove === "Forbidden",
      `link ${editor.link}, remove ${editor.remove}`,
    );

    await as(marge)((q) =>
      brain.share(
        q,
        { record: privateNote },
        {
          who: "member",
          id: otto.userId,
        },
        "owner",
      ),
    );
    const coOwner = await as(otto)(async (q) => {
      await brain.remove(q, privateNote);
      const [hidden] = await brain.get(q, [privateNote]);
      await brain.restore(q, privateNote);
      const [r] = await brain.get(q, [privateNote]);
      return { hidden, r };
    });
    check(
      "owner removes and restores",
      coOwner.hidden?.deletedAt instanceof Date &&
        coOwner.r?.access === "owner" &&
        coOwner.r.deletedAt === null,
      `removed at ${coOwner.hidden?.deletedAt?.toISOString()}, back as ${coOwner.r?.access}`,
    );

    // Groups: owners make them; a share to a group reaches its members.
    const bakers = await groupsDoor.defineGroup(
      marge,
      "Bakers",
      "At the ovens.",
    );
    await groupsDoor.addToGroup(marge, bakers, otto.userId);
    const [teamNote] = (
      await as(marge)((q) =>
        brain.write(q, { records: [noteOf("share-2", "Oven rota")] }),
      )
    ).records;
    await as(marge)((q) =>
      brain.share(
        q,
        { record: teamNote },
        {
          who: "group",
          id: bakers,
        },
        "view",
      ),
    );
    const reach = {
      otto: (await as(otto)((q) => brain.get(q, [teamNote]))).length,
      pim: (await as(pim)((q) => brain.get(q, [teamNote]))).length,
    };
    await groupsDoor.addToGroup(marge, bakers, pim.userId);
    const reachAfter = (await as(pim)((q) => brain.get(q, [teamNote]))).length;
    const notOwner = await attempt(() =>
      groupsDoor.defineGroup(pim, "Rebels", ""),
    );
    const listed = await groupsDoor.groupsOf(pim);
    check(
      "a group share follows the group",
      reach.otto === 1 &&
        reach.pim === 0 &&
        reachAfter === 1 &&
        notOwner === "Forbidden" &&
        listed[0].everyone &&
        listed[0].members.length === 3 &&
        listed.some((g) => g.name === "Bakers" && g.members.length === 2),
      `pim ${reach.pim} then ${reachAfter}, define as member ${notOwner}`,
    );

    // Everyone: view only.
    const [orgNote] = (
      await as(marge)((q) =>
        brain.write(q, { records: [noteOf("share-3", "Market day")] }),
      )
    ).records;
    const everyoneEdit = await attempt(() =>
      as(marge)((q) =>
        brain.share(q, { record: orgNote }, { who: "everyone" }, "edit"),
      ),
    );
    await as(marge)((q) =>
      brain.share(q, { record: orgNote }, { who: "everyone" }, "view"),
    );
    const pimSees = await as(pim)(async (q) => {
      const [r] = await brain.get(q, [orgNote]);
      const [own] = (
        await brain.write(q, {
          records: [noteOf("pim-1", "Pim's stall list")],
        })
      ).records;
      return {
        r,
        linkFrom: await attempt(() =>
          brain.write(q, {
            edges: [
              {
                from: { id: orgNote },
                verb: "mentions",
                to: { id: own },
              },
            ],
          }),
        ),
        linkTo: await attempt(() =>
          brain.write(q, {
            edges: [
              {
                from: { id: own },
                verb: "mentions",
                to: { id: orgNote },
              },
            ],
          }),
        ),
      };
    });
    const elsewhere = await as(ottoElsewhere)((q) =>
      brain.get(q, [privateNote, teamNote, orgNote]),
    );
    check(
      "everyone sees, at view, inside the org",
      everyoneEdit === "Invalid" &&
        pimSees.r?.access === "view" &&
        pimSees.linkFrom === "Forbidden" &&
        pimSees.linkTo === "allowed" &&
        elsewhere.length === 0,
      `everyone at edit ${everyoneEdit}, link from ${pimSees.linkFrom}, to ${pimSees.linkTo}, other org ${elsewhere.length}`,
    );

    // Export carries the shares a person gave, and nothing of anyone else's.
    const margeFile = await as(marge)((q) => brain.exportBrain(q));
    const ottoFile = await as(otto)((q) => brain.exportBrain(q));
    check(
      "export holds your rows and the shares you gave",
      margeFile.shares.length === 3 &&
        margeFile.shares.some((g) => g.subject === "everyone") &&
        margeFile.shares.some((g) => g.subject.group === "Bakers") &&
        margeFile.shares.some(
          (g) => g.subject.member === "editor@sharing.test",
        ) &&
        !ottoFile.records.some((r) => r.sourceRef === "share-1") &&
        ottoFile.records.some((r) => r.sourceRef === "otto-1"),
      `${margeFile.shares.length} shares, otto's file has ${ottoFile.records.length} records`,
    );

    // An editor cannot make themselves the owner, and a link's maker can
    // unlink it after its far end stopped being shared with them.
    await as(marge)((q) =>
      brain.share(
        q,
        { record: privateNote },
        {
          who: "member",
          id: otto.userId,
        },
        "edit",
      ),
    );
    const grab = await as(otto)((q) =>
      attempt(() =>
        q.query("update records set person_id = $2 where id = $1", [
          privateNote,
          otto.userId,
        ]),
      ),
    );
    const stillMarge = await as(marge)(async (q) => {
      const [r] = await brain.get(q, [privateNote]);
      return r.ownerId === marge.userId && r.access === "owner";
    });
    const edgeToNote = await as(otto)(async (q) => {
      const [own] = (
        await brain.write(q, {
          records: [noteOf("otto-3", "Otto links out")],
        })
      ).records;
      await brain.write(q, {
        edges: [
          {
            from: { id: own },
            verb: "mentions",
            to: { id: privateNote },
          },
        ],
      });
      return (await brain.edgesOf(q, own))[0].id;
    });
    await as(marge)((q) =>
      brain.unshare(
        q,
        { record: privateNote },
        { who: "member", id: otto.userId },
      ),
    );
    const unlinked = await as(otto)((q) =>
      attempt(() => brain.unlink(q, edgeToNote)),
    );
    check(
      "ownership cannot be taken; a maker can always unlink",
      grab !== "allowed" && stillMarge && unlinked === "allowed",
      `grab ${grab}, unlink ${unlinked}`,
    );
    await as(marge)((q) =>
      brain.share(
        q,
        { record: privateNote },
        {
          who: "member",
          id: otto.userId,
        },
        "owner",
      ),
    );

    // A co-owner's share on my record travels in my export with the record;
    // and a group from another org cannot be joined.
    await as(otto)((q) =>
      brain.share(
        q,
        { record: privateNote },
        {
          who: "member",
          id: pim.userId,
        },
        "view",
      ),
    );
    const margeGave = (await as(marge)((q) => brain.exportBrain(q))).shares
      .filter((g) => g.on.sourceRef === "share-1")
      .map((g) => g.subject.member ?? g.subject);
    const theirs = await groupsDoor.defineGroup(ottoElsewhere, "Theirs", "");
    const joinTheirs = await as(marge)((q) =>
      attempt(() =>
        q.query(
          "insert into group_members (group_id, member_id) values ($1, $2)",
          [theirs, otto.userId],
        ),
      ),
    );
    check(
      "shares on a record travel with it; groups stay in their org",
      margeGave.includes("viewer@sharing.test") && joinTheirs !== "allowed",
      `marge's shares on share-1: ${margeGave.join(", ") || "none"}; joining another org's group ${joinTheirs}`,
    );

    // An editor rewrites a link on a shared record; a ref two people carry
    // must be named by id; merging into an alias needs its winner.
    const relinked = await as(marge)(async (q) => {
      const [target] = (
        await brain.write(q, {
          records: [noteOf("target-1", "A target")],
        })
      ).records;
      await brain.share(
        q,
        { record: target },
        {
          who: "member",
          id: otto.userId,
        },
        "view",
      );
      await brain.write(q, {
        edges: [
          {
            from: { id: privateNote },
            verb: "mentions",
            to: { id: target },
            confidence: 0.5,
          },
        ],
      });
      return target;
    });
    const rewritten = await as(otto)((q) =>
      brain.write(q, {
        edges: [
          {
            from: { id: privateNote },
            verb: "mentions",
            to: { id: relinked },
            confidence: 0.9,
          },
        ],
      }),
    );
    for (const who of [marge, otto]) {
      await as(who)(async (q) => {
        const [dup] = (
          await brain.write(q, {
            records: [noteOf("dup-1", "Same ref")],
          })
        ).records;
        await brain.share(q, { record: dup }, { who: "everyone" }, "view");
      });
    }
    const ambiguous = await as(pim)(async (q) => {
      const [own] = (
        await brain.write(q, {
          records: [noteOf("pim-2", "Pim points")],
        })
      ).records;
      return attempt(() =>
        brain.write(q, {
          edges: [
            {
              from: { id: own },
              verb: "mentions",
              to: { source: "smoke", sourceRef: "dup-1" },
            },
          ],
        }),
      );
    });
    const [a, b, c] = (
      await as(marge)((q) =>
        brain.write(q, {
          records: [
            noteOf("marge-a", "Marge a"),
            noteOf("marge-b", "Marge b"),
            noteOf("marge-c", "Marge c"),
          ],
        }),
      )
    ).records;
    await as(marge)(async (q) => {
      await brain.merge(q, b, a);
      for (const r of [a, c]) {
        await brain.share(
          q,
          { record: r },
          { who: "member", id: otto.userId },
          "owner",
        );
      }
      await brain.share(
        q,
        { record: b },
        { who: "member", id: otto.userId },
        "view",
      );
    });
    const intoAlias = await as(otto)((q) =>
      attempt(() => brain.merge(q, a, c)),
    );
    const crossPerson = await as(otto)(async (q) => {
      const [o] = (
        await brain.write(q, {
          records: [noteOf("otto-5", "Otto's own")],
        })
      ).records;
      return attempt(() => brain.merge(q, c, o));
    });
    check(
      "editors relink, ambiguous refs are refused, a merge needs its winner",
      rewritten.edges === 1 &&
        ambiguous === "Invalid" &&
        intoAlias === "Forbidden" &&
        crossPerson === "Invalid",
      `relink ${rewritten.edges}, ambiguous ${ambiguous}, merge into alias ${intoAlias}, across people ${crossPerson}`,
    );

    // A deleted group takes its shares with it, even on records the org
    // owner does not own.
    const [ottoNote] = (
      await as(otto)((q) =>
        brain.write(q, { records: [noteOf("otto-2", "Otto's rota")] }),
      )
    ).records;
    await as(otto)((q) =>
      brain.share(
        q,
        { record: ottoNote },
        {
          who: "group",
          id: bakers,
        },
        "view",
      ),
    );
    const pimHad = (await as(pim)((q) => brain.get(q, [ottoNote]))).length;
    await groupsDoor.deleteGroup(marge, bakers);
    const pimHas = (await as(pim)((q) => brain.get(q, [ottoNote]))).length;
    check(
      "deleting a group takes its shares",
      pimHad === 1 && pimHas === 0,
      `pim ${pimHad} then ${pimHas}`,
    );

    await as(marge)((q) =>
      brain.unshare(
        q,
        { record: privateNote },
        { who: "member", id: otto.userId },
      ),
    );
    const gone = (await as(otto)((q) => brain.get(q, [privateNote]))).length;
    check("unshare takes it away", gone === 0, `${gone} records`);

    // The agent asks; the owner decides. Nothing is shared by an ask, a
    // colleague cannot ask on the owner's behalf, and accepting makes the
    // shares in the owner's name while declining makes none.
    const asked = await as(marge)(async (q) => {
      const ask = await brain.askToShare(q, {
        records: [privateNote],
        to: ["editor@sharing.test", "everyone"],
        level: "view",
        reason: "Otto is picking up the levain this week.",
      });
      const nobody = await attempt(() =>
        brain.askToShare(q, {
          records: [privateNote],
          to: ["nobody@sharing.test"],
          level: "view",
          reason: "x",
        }),
      );
      const tooMuch = await attempt(() =>
        brain.askToShare(q, {
          records: [privateNote],
          to: ["everyone"],
          level: "edit",
          reason: "x",
        }),
      );
      return {
        ask,
        nobody,
        tooMuch,
        waiting: await brain.requestsOf(q),
        count: await brain.waiting(q),
      };
    });
    const askedByOther = await as(otto)((q) =>
      attempt(() =>
        brain.askToShare(q, {
          records: [privateNote],
          to: ["viewer@sharing.test"],
          level: "view",
          reason: "x",
        }),
      ),
    );
    const beforeAnswer = (await as(otto)((q) => brain.get(q, [privateNote])))
      .length;
    const declined = await as(marge)(async (q) => {
      await brain.declineRequest(q, asked.ask.id);
      return (await brain.requestsOf(q)).length;
    });
    const stillHidden = (await as(otto)((q) => brain.get(q, [privateNote])))
      .length;
    const made = await as(marge)(async (q) => {
      const again = await brain.askToShare(q, {
        records: [privateNote],
        to: ["editor@sharing.test"],
        level: "view",
        reason: "Otto is picking up the levain this week.",
      });
      return brain.acceptRequest(q, again.id);
    });
    const nowSeen = (await as(otto)((q) => brain.get(q, [privateNote]))).length;
    // An ask that names something removed since shares what is left.
    const stale = await as(marge)(async (q) => {
      const [gone] = (
        await brain.write(q, { records: [noteOf("ask-gone", "Soon gone")] })
      ).records;
      const ask = await brain.askToShare(q, {
        records: [gone, privateNote],
        to: ["viewer@sharing.test"],
        level: "view",
        reason: "x",
      });
      await brain.remove(q, gone);
      const made = await brain.acceptRequest(q, ask.id);
      await brain.unshare(
        q,
        { record: privateNote },
        { who: "member", id: pim.userId },
      );
      // A group deleted since is left out too, and the ask still clears.
      const rota = await groupsDoor.defineGroup(marge, "Rota", "");
      const toRota = await brain.askToShare(q, {
        records: [privateNote],
        to: ["Rota"],
        level: "view",
        reason: "x",
      });
      await groupsDoor.deleteGroup(marge, rota);
      const toNobody = await brain.acceptRequest(q, toRota.id);
      return {
        made,
        toNobody,
        left: (await brain.requestsOf(q)).length,
      };
    });
    check(
      "the agent asks to share and the owner decides",
      asked.ask.subjects.length === 2 &&
        asked.waiting.length === 1 &&
        asked.count === 1 &&
        asked.nobody === "NotFound" &&
        asked.tooMuch === "Invalid" &&
        askedByOther === "NotFound" &&
        beforeAnswer === 0 &&
        declined === 0 &&
        stillHidden === 0 &&
        made === 1 &&
        nowSeen === 1 &&
        stale.made === 1 &&
        stale.toNobody === 0 &&
        stale.left === 0,
      `removed since shares ${stale.made}, deleted group ${stale.toNobody}; asked ${asked.waiting.length}, unknown ${asked.nobody}, everyone at edit ${asked.tooMuch}, colleague asks ${askedByOther}, seen ${beforeAnswer}/${stillHidden}/${nowSeen}`,
    );
    await as(marge)((q) =>
      brain.unshare(
        q,
        { record: privateNote },
        { who: "member", id: otto.userId },
      ),
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
    // A type shared whole travels in the file as a share by name. It stays
    // shared: the agent's smoke reads it as a colleague.
    await me(acme)(async (q) => {
      const lift = (await brain.catalog(q)).types.find(
        (k) => k.name === "lift",
      );
      await brain.share(q, { type: lift.id }, { who: "everyone" }, "view");
    });
    const exported = await me(acme)((q) => brain.exportBrain(q));
    const imported = await asPerson(
      { orgId: target, personId: targetPerson, userId: targetPerson },
      async (q) => {
        const counts = await brain.importBrain(q, exported);
        const twice = await brain.importBrain(q, exported);
        const beep = (await brain.read(q, { type: "person" })).records.find(
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
        imported.vocab.types.length === vocab.types.length &&
        imported.vocab.types.find((k) => k.name === "lift").properties
          .length === 2 &&
        imported.counts.merges === 2 &&
        imported.aboutBeep.records.length === 5 &&
        exported.shares.length === 1 &&
        exported.shares[0].on.type === "lift" &&
        exported.shares[0].subject === "everyone" &&
        imported.counts.shares === 1,
      `${imported.all.records.length} records, ${imported.counts.edges} edges, ${imported.counts.properties} fields, ${imported.counts.merges} merges, ${imported.counts.shares} shares`,
    );
    check(
      "importing twice adds nothing",
      imported.twice.records === 0 &&
        imported.twice.edges === 0 &&
        imported.twice.types === 0 &&
        imported.twice.properties === 0 &&
        imported.twice.merges === 0 &&
        imported.twice.shares === 0,
      `${imported.twice.records} records, ${imported.twice.edges} edges`,
    );
  }
}
