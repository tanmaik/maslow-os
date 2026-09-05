import { asOrg } from "@placeholder/db";
import { fullName, membershipsOf } from "@placeholder/db/auth";
import { redirect } from "next/navigation";

import { SignIn, notice, type Notice } from "@/components/sign-in";
import { Button } from "@/components/ui/button";
import { authorizationRequest } from "@/lib/oauth";
import { principal } from "@/lib/session";

// An app asking in. Signed out, the sign-in, which comes back here; signed
// in, who is asking and as whom they would be let in, to allow or refuse.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const given = await searchParams;
  const params = new URLSearchParams(
    Object.entries(given).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v]] : [],
    ),
  );
  const asked = authorizationRequest(params);
  if (!asked.ok) {
    if (asked.back) redirect(asked.back.toString());
    return (
      <main className="space-y-4">
        <h1 className="text-2xl font-semibold">Can&apos;t connect</h1>
        <p className="text-muted-foreground">
          This request is not one an app of ours would make: {asked.problem}.
        </p>
      </main>
    );
  }
  const p = await principal();
  if (!p)
    return (
      <SignIn
        said={notice(given as Notice)}
        next={`/oauth/authorize?${params}`}
      />
    );

  const { client } = asked.request;
  const { orgName, me } = await asOrg(p.orgId, async (q) => ({
    orgName: (await q.query<{ name: string }>("select name from orgs")).rows[0]
      ?.name,
    me: (
      await q.query<{ firstName: string; lastName: string | null }>(
        'select first_name as "firstName", last_name as "lastName" from users where id = $1',
        [p.userId],
      )
    ).rows[0],
  }));
  const others = (await membershipsOf(p)).filter((m) => m.userId !== p.userId);

  return (
    <main className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Connect {client.name}?</h1>
      <p>
        <span className="font-medium">{client.name}</span> wants to read and
        write the brain as{" "}
        <span className="font-medium">{me && fullName(me)}</span> in{" "}
        <span className="font-medium">{orgName}</span>. It keeps that access
        until you disconnect it in settings.
      </p>
      <form action="/oauth/approve" method="post" className="flex gap-2">
        {[...params].map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Button type="submit" name="decision" value="allow">
          Allow
        </Button>
        <Button type="submit" name="decision" value="deny" variant="outline">
          Deny
        </Button>
      </form>
      {others.length > 0 && (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Or connect it to another of your orgs:
          </p>
          <div className="flex flex-wrap gap-2">
            {others.map((m) => (
              <form key={m.userId} action="/auth/switch" method="post">
                <input type="hidden" name="membership" value={m.userId} />
                <input
                  type="hidden"
                  name="next"
                  value={`/oauth/authorize?${params}`}
                />
                <Button type="submit" variant="secondary" size="sm">
                  {m.orgName}
                </Button>
              </form>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
