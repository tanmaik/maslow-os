import { asOrg } from "@placeholder/db";

import { after } from "next/server";

import { SignIn, notice, type Notice } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { sweepIfDue } from "@/lib/meter";
import { principal } from "@/lib/session";

type Member = { id: string; name: string; email: string };

// Home for the signed-in person: their org, and the way to its settings.
// Signed out, a way in.
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

  const { orgName, members, me } = await asOrg(p.orgId, async (q) => {
    const rows = (
      await q.query<Member>("select id, name, email from users order by name")
    ).rows;
    return {
      orgName: (await q.query<{ name: string }>("select name from orgs"))
        .rows[0]?.name,
      members: rows.length,
      me: rows.find((m) => m.id === p.userId),
    };
  });

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold">{orgName}</h1>
      <p className="text-muted-foreground">
        {members} {members === 1 ? "member" : "members"}
        {me && ` · you are ${me.name}`}. Invite people and manage the org in{" "}
        <a href="/settings" className="underline">
          settings
        </a>
        .
      </p>
      <Button nativeButton={false} render={<a href="/brain" />}>
        Open the brain
      </Button>
    </main>
  );
}
