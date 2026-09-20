// Pooled requests must never inherit another request's identity, including
// after a failed transaction or a connection carrying session-level settings.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  asEmail,
  asOrg,
  asPerson,
  asSelf,
  Gone,
} from "../packages/db/src/index.ts";
import { portsReaching, sharePort } from "../packages/db/src/computers.ts";
import {
  copyAt,
  filesReaching,
  giveFile,
  setCopy,
  shareFile,
} from "../packages/db/src/shared-files.ts";
import { orgs } from "../packages/db/src/seed.ts";

const pg = createRequire(
  new URL("../packages/db/package.json", import.meta.url),
)("pg");

export async function smokeDb({ pgPort }) {
  await globalThis.__pool?.end();
  const pool = new pg.Pool({
    connectionString: `postgres://app@127.0.0.1:${pgPort}/postgres`,
    max: 1,
  });
  globalThis.__pool = pool;
  const [acme, bakery] = orgs;
  const person = (org) => ({
    orgId: org.id,
    personId: org.users[0].personId,
    userId: org.users[0].id,
  });
  const identity = async (q) =>
    (
      await q.query(`select
    current_setting('app.org_id', true) as org,
    current_setting('app.person_id', true) as person,
    current_setting('app.member_id', true) as member,
    current_setting('app.email', true) as email`)
    ).rows[0];
  let ok = true;
  const check = async (label, fn) => {
    try {
      await fn();
      console.log(`ok    db: ${label}`);
    } catch (err) {
      ok = false;
      console.error(`FAIL  db: ${label}`, err);
    }
  };
  try {
    await check("the pooled role cannot bypass row policies", async () => {
      const {
        rows: [role],
      } = await pool.query(
        "select rolsuper, rolbypassrls from pg_roles where rolname = current_user",
      );
      assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
    });
    await check("each queued person sees only their own org", async () => {
      await Promise.all(
        Array.from({ length: 12 }, (_, i) => {
          const org = orgs[i % orgs.length];
          return asPerson(person(org), async (q) => {
            const who = await identity(q);
            assert.equal(who.org, org.id);
            assert.equal(who.person, org.users[0].personId);
            assert.equal(who.member, org.users[0].id);
            assert.deepEqual((await q.query("select id from orgs")).rows, [
              { id: org.id },
            ]);
          });
        }),
      );
    });
    await check(
      "org and email scopes shed a poisoned connection's identity",
      async () => {
        await pool.query(
          "select set_config('app.org_id', $1, false), set_config('app.person_id', $2, false), set_config('app.member_id', $3, false), set_config('app.email', $4, false)",
          [
            acme.id,
            acme.users[0].personId,
            acme.users[0].id,
            acme.users[0].email,
          ],
        );
        await asOrg(bakery.id, async (q) => {
          const who = await identity(q);
          assert.equal(who.org, bakery.id);
          assert.ok(!who.person && !who.member && !who.email);
          assert.equal((await q.query("select id from records")).rowCount, 0);
        });
        await asEmail(bakery.users[0].email, async (q) => {
          const who = await identity(q);
          assert.equal(who.email, bakery.users[0].email);
          assert.ok(!who.org && !who.person && !who.member);
          // An email sees the orgs it belongs to and no other.
          const ids = (rows) => rows.map((r) => r.id).sort();
          assert.deepEqual(
            ids((await q.query("select id from orgs")).rows),
            ids(
              (
                await q.query(
                  "select distinct org_id as id from users where email = $1",
                  [bakery.users[0].email],
                )
              ).rows,
            ),
          );
        });
      },
    );
    await check(
      "callback and SQL failures roll back before pool reuse",
      async () => {
        const before = await asOrg(
          acme.id,
          async (q) => (await q.query("select name from orgs")).rows[0].name,
        );
        const failure = new Error("rollback this request");
        await assert.rejects(
          asPerson(person(acme), async (q) => {
            await q.query("update orgs set name = 'Must roll back'");
            throw failure;
          }),
          (err) => err === failure,
        );
        await assert.rejects(
          asPerson(person(acme), (q) => q.query("select 1/0")),
          { code: "22012" },
        );
        assert.equal(
          await asOrg(
            acme.id,
            async (q) => (await q.query("select name from orgs")).rows[0].name,
          ),
          before,
        );
        assert.equal(
          await asPerson(person(bakery), async (q) => (await identity(q)).org),
          bakery.id,
        );
        const who = await identity(pool);
        assert.ok(!who.org && !who.person && !who.member && !who.email);
      },
    );
    await check(
      "mismatched memberships never reach a person's callback",
      async () => {
        for (const scope of [asPerson, asSelf]) {
          let called = false;
          await assert.rejects(
            scope({ ...person(acme), userId: bakery.users[0].id }, async () => {
              called = true;
            }),
            Gone,
          );
          assert.equal(called, false);
          assert.equal(
            await scope(
              person(bakery),
              async (q) => (await identity(q)).member,
            ),
            bakery.users[0].id,
          );
        }
      },
    );
    await check(
      "a port is given by its computer's owner and seen by nobody else",
      async () => {
        const [wile, road] = acme.users;
        const marge = bakery.users[0];
        const mine = {
          orgId: acme.id,
          personId: wile.personId,
          userId: wile.id,
        };
        const theirs = {
          orgId: acme.id,
          personId: road.personId,
          userId: road.id,
        };
        const computer = await asPerson(mine, async (q) => {
          await q.query(
            `insert into computers (user_id, region, cpus, memory_mb, disk_gb, secret)
             values ($1, 'sjc', 1, 512, 1, 'x')
             on conflict (org_id, user_id) do update set region = 'sjc'
             returning id`,
            [wile.id],
          );
          return (await q.query("select id from computers")).rows[0].id;
        });
        // Its owner gives it; nobody else can give away what is not theirs.
        await asPerson(mine, (q) =>
          q.query(
            "insert into port_shares (computer_id, port, subject, member_id) values ($1, 3000, 'member', $2)",
            [computer, road.id],
          ),
        );
        await assert.rejects(
          asPerson(theirs, (q) =>
            q.query(
              "insert into port_shares (computer_id, port, subject, member_id) values ($1, 3001, 'member', $2)",
              [computer, road.id],
            ),
          ),
          /row-level security/,
        );
        // Nobody outside the org can be given one at all.
        await assert.rejects(
          asPerson(mine, (q) =>
            q.query(
              "insert into port_shares (computer_id, port, subject, member_id) values ($1, 3002, 'member', $2)",
              [computer, marge.id],
            ),
          ),
          /violates foreign key/,
        );
        // The owner sees every share on it; the person given one sees theirs.
        assert.equal(
          (await asPerson(mine, (q) => q.query("select 1 from port_shares")))
            .rowCount,
          1,
        );
        assert.equal(
          (await asPerson(theirs, (q) => q.query("select 1 from port_shares")))
            .rowCount,
          1,
        );
        // Taking it away is the owner's: the person it was given to can see
        // it and cannot remove it, so their delete takes nothing.
        assert.equal(
          (await asPerson(theirs, (q) => q.query("delete from port_shares")))
            .rowCount,
          0,
        );
        await asPerson(mine, (q) => q.query("delete from port_shares"));
        assert.equal(
          (await asPerson(mine, (q) => q.query("select 1 from port_shares")))
            .rowCount,
          0,
        );
        // A port open to everyone reaches everyone in this org and nobody in
        // another, and one given to a group reaches whoever is in it.
        const group = await asPerson(mine, async (q) => {
          const made = await q.query(
            "insert into groups (name, author) values ('Sled crew', $1) returning id",
            [wile.id],
          );
          await q.query(
            "insert into group_members (group_id, member_id) values ($1, $2)",
            [made.rows[0].id, road.id],
          );
          return made.rows[0].id;
        });
        const seen = (who) =>
          asPerson(who, async (q) =>
            Number((await q.query("select 1 from port_shares")).rowCount),
          );
        const others = {
          orgId: bakery.id,
          personId: marge.personId,
          userId: marge.id,
        };
        await asPerson(mine, (q) =>
          q.query(
            "insert into port_shares (computer_id, port, subject) values ($1, 4000, 'everyone')",
            [computer],
          ),
        );
        assert.equal(await seen(theirs), 1);
        assert.equal(await seen(others), 0);
        await asPerson(mine, (q) =>
          q.query(
            "insert into port_shares (computer_id, port, subject, group_id) values ($1, 4001, 'group', $2)",
            [computer, group],
          ),
        );
        assert.equal(await seen(theirs), 2);
        // What reaches a person is listed for them, with whose it is, and
        // never their own or another org's.
        await asPerson(mine, (q) =>
          q.query("update computers set machine_id = 'smoke-machine'"),
        );
        const reaching = (who) =>
          asPerson(who, async (q) =>
            (await portsReaching(q)).map((s) => `${s.machineId}:${s.port}`),
          );
        assert.deepEqual(await reaching(theirs), [
          "smoke-machine:4000",
          "smoke-machine:4001",
        ]);
        assert.deepEqual(await reaching(mine), []);
        // And how each reaches them: to everyone, or through a group of
        // theirs by its name.
        const via = await asPerson(theirs, async (q) =>
          (await portsReaching(q)).map((s) => s.via),
        );
        assert.deepEqual(via[0], ["everyone"]);
        // A port made public is open to anyone with its address and given
        // to nobody: it is not among what reaches a colleague.
        await asPerson(mine, (q) =>
          q.query(
            "insert into port_shares (computer_id, port, subject) values ($1, 4002, 'public')",
            [computer],
          ),
        );
        assert.deepEqual(await reaching(theirs), [
          "smoke-machine:4000",
          "smoke-machine:4001",
        ]);
        assert.equal(via[1].length, 1);
        assert.match(via[1][0], /^group:./);
        assert.deepEqual(await reaching(others), []);
        // A share must name exactly the one thing it reaches.
        await assert.rejects(
          asPerson(mine, (q) =>
            q.query(
              "insert into port_shares (computer_id, port, subject, member_id, group_id) values ($1, 4002, 'member', $2, $3)",
              [computer, road.id, group],
            ),
          ),
          /port_share_names_its_subject/,
        );
        await asPerson(mine, (q) => q.query("delete from port_shares"));
        // The sheet sets a port's whole reach: whoever is unticked is taken
        // off in the same act, whatever kind of party stays ticked.
        const reachOf = () =>
          asPerson(mine, async (q) =>
            (
              await q.query(
                "select subject from port_shares where port = 5000 order by subject",
              )
            ).rows
              .map((r) => r.subject)
              .join(","),
          );
        await asPerson(mine, (q) =>
          sharePort(q, computer, 5000, {
            everyone: true,
            groupIds: [group],
            memberIds: [road.id],
          }),
        );
        assert.equal(await reachOf(), "everyone,group,member");
        await asPerson(mine, (q) =>
          sharePort(q, computer, 5000, {
            everyone: false,
            groupIds: [group],
            memberIds: [],
          }),
        );
        assert.equal(await reachOf(), "group");
        await asPerson(mine, (q) =>
          sharePort(q, computer, 5000, {
            everyone: false,
            groupIds: [],
            memberIds: [road.id],
          }),
        );
        assert.equal(await reachOf(), "member");
        await asPerson(mine, (q) =>
          sharePort(q, computer, 5000, {
            everyone: false,
            groupIds: [],
            memberIds: [],
          }),
        );
        assert.equal(await reachOf(), "");
        // Setting one port's reach leaves another port's shares untouched.
        await asPerson(mine, (q) =>
          sharePort(q, computer, 6000, {
            everyone: false,
            groupIds: [],
            memberIds: [road.id],
          }),
        );
        await asPerson(mine, (q) =>
          sharePort(q, computer, 5000, {
            everyone: true,
            groupIds: [],
            memberIds: [],
          }),
        );
        assert.equal(
          (
            await asPerson(mine, (q) =>
              q.query("select 1 from port_shares where port = 6000"),
            )
          ).rowCount,
          1,
        );
        await asPerson(mine, (q) => q.query("delete from port_shares"));
      },
    );
    await check(
      "a file is shared by its computer's owner, at a level, and its copy goes with it",
      async () => {
        const [wile, road] = acme.users;
        const marge = bakery.users[0];
        const mine = {
          orgId: acme.id,
          personId: wile.personId,
          userId: wile.id,
        };
        const theirs = {
          orgId: acme.id,
          personId: road.personId,
          userId: road.id,
        };
        const others = {
          orgId: bakery.id,
          personId: marge.personId,
          userId: marge.id,
        };
        const computer = await asPerson(
          mine,
          async (q) => (await q.query("select id from computers")).rows[0].id,
        );
        const plan = {
          id: "plan000001",
          computerId: computer,
          name: "plan.md",
          kind: "file",
        };
        // The owner shares it at edit with one person; only they see it,
        // and only at that level. Nobody else can share what is not theirs.
        await asPerson(mine, (q) =>
          shareFile(q, plan, {
            everyone: false,
            groupIds: [],
            memberIds: [road.id],
            level: "edit",
          }),
        );
        await assert.rejects(
          asPerson(theirs, (q) =>
            shareFile(q, plan, {
              everyone: false,
              groupIds: [],
              memberIds: [road.id],
              level: "view",
            }),
          ),
          /row-level security/,
        );
        const level = (who) =>
          asPerson(
            who,
            async (q) =>
              (await q.query("select file_level($1) as level", [plan.id]))
                .rows[0].level,
          );
        assert.equal(await level(mine), "owner");
        assert.equal(await level(theirs), "edit");
        assert.equal(await level(others), null);
        // What reaches a person is listed for them with whose it is, and
        // the owner's own are not among theirs.
        assert.deepEqual(
          await asPerson(theirs, async (q) =>
            (await filesReaching(q)).map(
              (f) => `${f.name}:${f.level}:${f.owner}`,
            ),
          ),
          ["plan.md:edit:Wile Coyote"],
        );
        assert.deepEqual(await asPerson(mine, filesReaching), []);
        assert.deepEqual(await asPerson(others, filesReaching), []);
        // Everyone can only be given view, and a copy an editor writes is
        // seen by the owner, while a viewer cannot write one.
        await assert.rejects(
          asPerson(mine, (q) =>
            q.query(
              "insert into file_shares (computer_id, file_id, subject, level) values ($1, $2, 'everyone', 'edit')",
              [computer, plan.id],
            ),
          ),
          /everyone_only_views/,
        );
        await asPerson(theirs, (q) =>
          setCopy(q, {
            fileId: plan.id,
            path: "",
            key: "shares/plan000001/plan.md",
            bytes: 12,
            modified: new Date("2026-09-16T00:00:00Z"),
            pending: true,
          }),
        );
        assert.equal(
          (await asPerson(mine, (q) => copyAt(q, plan.id, "")))?.pending,
          true,
        );
        await asPerson(mine, (q) =>
          shareFile(q, plan, {
            everyone: true,
            groupIds: [],
            memberIds: [],
            level: "view",
          }),
        );
        assert.equal(await level(theirs), "view");
        await assert.rejects(
          asPerson(theirs, (q) =>
            setCopy(q, {
              fileId: plan.id,
              path: "",
              key: "shares/plan000001/plan.md",
              bytes: 13,
              modified: new Date(),
              pending: true,
            }),
          ),
          /row-level security/,
        );
        // Accepting an ask gives one more party without taking any away.
        await asPerson(mine, (q) =>
          giveFile(q, plan, { who: "member", id: road.id }, "edit"),
        );
        assert.equal(await level(theirs), "edit");
        // Sharing it with nobody takes the thing away, and its copy's
        // object is owed its deletion.
        assert.equal(
          await asPerson(mine, (q) =>
            shareFile(q, plan, {
              everyone: false,
              groupIds: [],
              memberIds: [],
              level: "view",
            }),
          ),
          false,
        );
        assert.equal(await level(theirs), null);
        assert.equal(
          (
            await asPerson(mine, (q) =>
              q.query(
                "select 1 from orphans where kind = 'copy' and ref = 'shares/plan000001/plan.md'",
              ),
            )
          ).rowCount,
          1,
        );
        await asPerson(mine, (q) =>
          q.query("delete from orphans where kind = 'copy'"),
        );
      },
    );
  } finally {
    await pool.end();
    globalThis.__pool = undefined;
  }
  return ok;
}
