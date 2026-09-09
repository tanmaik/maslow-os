import { requestsOf, stubs } from "@maslow/brain";
import { asOrg, asPerson } from "@maslow/db";
import { groupsIn } from "@maslow/db/groups";
import { after } from "next/server";

import { SignIn, notice, type Notice } from "@/components/sign-in";
import { sweepIfDue } from "@/lib/meter";
import { principal } from "@/lib/session";

import { Asks } from "./brain/asks";
import { vocabulary } from "./brain/catalog";
import { Rail } from "./room/rail";
import { Zoom } from "./room/zoom";

// Home for the signed-in person is their room: what asks something of
// them, and who is in the org. Signed out, a way in.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Notice>;
}) {
  const said = notice(await searchParams);
  const p = await principal();
  if (!p) return <SignIn said={said} />;
  // A look at the site is what runs the hourly sweep outside production.
  after(() => sweepIfDue());

  const [{ types, people }, orgName, { asks, asked, groups }] =
    await Promise.all([
      vocabulary(p),
      asOrg(
        p.orgId,
        async (q) =>
          (await q.query<{ name: string }>("select name from orgs")).rows[0]
            ?.name,
      ),
      asPerson(p, async (db) => {
        const asks = await requestsOf(db);
        return {
          asks,
          asked: await stubs(
            db,
            asks.flatMap((a) =>
              a.items.flatMap((it) => ("record" in it ? [it.record] : [])),
            ),
          ),
          groups: asks.length ? await groupsIn(db) : [],
        };
      }),
    ]);

  return (
    <div className="flex items-start gap-6">
      <h1 className="sr-only">{orgName}</h1>
      <Rail
        people={[...people]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name))}
      />
      <main className="min-w-0 flex-1">
        <Zoom>
          {asks.length > 0 ? (
            <Asks
              asks={asks}
              records={new Map(asked.map((r) => [r.id, r]))}
              types={types}
              people={people}
              groups={groups}
              back="/"
            />
          ) : (
            <p className="text-muted-foreground px-1 py-2 text-sm">
              Nothing is in front of you. What a teammate&apos;s agent puts in
              front of you lands here.
            </p>
          )}
        </Zoom>
      </main>
    </div>
  );
}
