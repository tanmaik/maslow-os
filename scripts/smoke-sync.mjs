// The relay, driven from Node: two people in one record's live document,
// what each typed landing as one body in both their names, an agent's
// rewrite reaching both, a share that ends putting its person out, and a
// viewer unable to write. Returns true when every check passed.
import { orgs } from "../packages/db/src/seed.ts";
import { asPerson } from "../packages/db/src/index.ts";
import * as brain from "../packages/brain/src/index.ts";
import { open } from "../packages/sync/src/client.ts";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function smokeSync(stack, signIn) {
  let ok = true;
  const check = (label, pass, detail) => {
    console.log(
      `${pass ? "ok  " : "FAIL"}  sync: ${label.padEnd(34)} ${detail}`,
    );
    ok &&= pass;
  };
  const [acme] = orgs;
  const member = (i) => ({
    orgId: acme.id,
    personId: acme.users[i].personId,
    userId: acme.users[i].id,
    role: i === 0 ? "owner" : "member",
  });
  const as = (i) => (fn) => asPerson(member(i), fn);
  const opened = [];
  try {
    // Marge's note, opened to Road Runner to edit.
    const id = await as(0)(async (q) => {
      const { records } = await brain.write(q, {
        records: [
          {
            type: "note",
            source: "smoke",
            sourceRef: "live",
            title: "Live note",
            body: "Start.",
          },
        ],
      });
      const [rid] = records;
      await brain.share(
        q,
        { record: rid },
        { who: "member", id: acme.users[1].id },
        "edit",
      );
      return rid;
    });
    const way = async (i) => {
      const res = await fetch(`${stack.url}/brain/records/${id}/live`, {
        headers: { cookie: await signIn(acme.users[i].id) },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`live answered ${res.status}`);
      return res.json();
    };
    // A connection the relay rejects never syncs, so a rejection fails
    // this check at once, with the relay's own error output; one the
    // relay never answers fails after twenty seconds, saying whether the
    // relay is still running.
    const join = async (i) => {
      const { url, name, ticket } = await way(i);
      const person = open(url, name, ticket);
      opened.push(person);
      await Promise.race([
        person.synced,
        person.closed.then(() => {
          throw new Error(`the relay rejected it: ${stack.sync.said()}`);
        }),
        wait(20_000).then(() => {
          throw new Error(
            `the relay did not answer in 20s; relay ${stack.sync.up() ? "up" : "down"}: ${stack.sync.said()}`,
          );
        }),
      ]);
      return person;
    };
    // Request the app's sync route once before connecting, so `next dev`
    // has compiled it before the relay's eight-second call to it.
    await fetch(`${stack.url}/brain/sync/${id}`, {
      signal: AbortSignal.timeout(20_000),
    });
    const marge = await join(0);
    const runner = await join(1);
    check(
      "a record opens as its body",
      marge.editor.markdown() === "Start." &&
        runner.editor.markdown() === "Start.",
      JSON.stringify(marge.editor.markdown()),
    );

    // Two people type; each sees the other, and the brain has both, saved
    // in each of their names.
    marge.type(" Marge typed.");
    await wait(300);
    runner.type(" Runner typed.");
    await wait(2500);
    const after = await as(0)(async (q) => {
      const [r] = await brain.get(q, [id]);
      const log = await brain.history(q, { of: id, limit: 5 });
      return { body: r.body, by: log.map((e) => e.author) };
    });
    const both = "Start. Marge typed. Runner typed.";
    check(
      "typing merges and lands as one body",
      marge.editor.markdown() === both &&
        runner.editor.markdown() === both &&
        after.body === both,
      JSON.stringify(after.body),
    );
    check(
      "each save is in its typist's name",
      after.by.includes(`person:${acme.users[0].id}`) &&
        after.by.includes(`person:${acme.users[1].id}`),
      after.by.slice(0, 3).join(", "),
    );

    // A title changed elsewhere does not touch what is being typed.
    marge.type(" More.");
    await as(0)((q) => brain.edit(q, id, { title: "Live note, renamed" }));
    await wait(3000);
    const more = await as(0)(async (q) => (await brain.get(q, [id]))[0].body);
    check(
      "a title changed elsewhere leaves the typing be",
      more === `${both} More.` && marge.editor.markdown() === more,
      JSON.stringify([more, marge.editor.markdown()]),
    );

    // An agent rewrites the record from outside; both see it.
    await as(0)((q) => brain.edit(q, id, { body: "Agent rewrote." }));
    await wait(3000);
    check(
      "a rewrite from outside reaches everyone",
      marge.editor.markdown() === "Agent rewrote." &&
        runner.editor.markdown() === "Agent rewrote.",
      JSON.stringify([marge.editor.markdown(), runner.editor.markdown()]),
    );

    // A share that ends puts its person out.
    await as(0)((q) =>
      brain.unshare(q, { record: id }, { who: "member", id: acme.users[1].id }),
    );
    const out = await Promise.race([
      runner.closed.then(() => "out"),
      wait(6000).then(() => "still in"),
    ]);
    check("an ended share puts its person out", out === "out", out);

    // Let back in to view, they see the text and cannot change it.
    await as(0)((q) =>
      brain.share(
        q,
        { record: id },
        { who: "member", id: acme.users[1].id },
        "view",
      ),
    );
    const viewer = await join(1);
    viewer.type(" Viewer wrote.");
    await wait(2000);
    const seen = await as(0)(async (q) => (await brain.get(q, [id]))[0].body);
    check(
      "a viewer cannot write",
      seen === "Agent rewrote." && marge.editor.markdown() === "Agent rewrote.",
      JSON.stringify([seen, marge.editor.markdown()]),
    );

    // A body the editor cannot hold whole is never made live.
    const table = await as(0)(async (q) => {
      const { records } = await brain.write(q, {
        records: [
          {
            type: "note",
            source: "smoke",
            sourceRef: "table",
            title: "A table",
            body: "| a | b |\n| - | - |\n| 1 | 2 |",
          },
        ],
      });
      return records[0];
    });
    const { url, name, ticket } = await (async () => {
      const res = await fetch(`${stack.url}/brain/records/${table}/live`, {
        headers: { cookie: await signIn(acme.users[0].id) },
      });
      return res.json();
    })();
    const tabled = open(url, name, ticket);
    opened.push(tabled);
    const fate = await Promise.race([
      tabled.synced.then(() => "synced"),
      tabled.closed.then(() => "closed"),
      wait(6000).then(() => "neither"),
    ]);
    const kept = await as(0)(
      async (q) => (await brain.get(q, [table]))[0].body,
    );
    check(
      "a body the editor cannot hold is not made live",
      fate === "closed" && kept === "| a | b |\n| - | - |\n| 1 | 2 |",
      `${fate}, body ${JSON.stringify(kept)}`,
    );
  } catch (err) {
    check(
      "the relay",
      false,
      `${err.stack ?? String(err)}\nrelay ${stack.sync.up() ? "up" : "down"}: ${stack.sync.said()}`,
    );
  } finally {
    for (const p of opened) p.close();
  }
  return ok;
}
