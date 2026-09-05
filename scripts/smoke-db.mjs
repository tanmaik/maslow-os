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
          assert.equal((await q.query("select id from orgs")).rowCount, 0);
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
  } finally {
    await pool.end();
    globalThis.__pool = undefined;
  }
  return ok;
}
