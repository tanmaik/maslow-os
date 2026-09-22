import { asOrg } from "@maslow/db";
import { fullName, membershipsOf } from "@maslow/db/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Door, SignIn, notice, type Notice } from "@/components/sign-in";
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
  const asked = await authorizationRequest(params);
  if (!asked.ok) {
    if (asked.back) redirect(asked.back.toString());
    return (
      <Door
        title="Can't connect"
        description={`This request is not one an app of ours would make: ${asked.problem}.`}
      >
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href="/" />}
        >
          Go home
        </Button>
      </Door>
    );
  }
  const p = await principal();
  if (!p)
    return (
      <SignIn
        said={notice(given as Notice)}
        next={`/oauth/authorize?${params}`}
        because={`Sign in to let ${asked.request.client.name} into your database.`}
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
    <Door
      title={`Connect ${client.name}?`}
      description={
        <>
          <span className="text-sm font-medium text-foreground">
            {client.name}
          </span>{" "}
          wants to read and write your brain as{" "}
          <span className="text-sm font-medium text-foreground">
            {me && fullName(me)}
          </span>{" "}
          in{" "}
          <span className="text-sm font-medium text-foreground">{orgName}</span>
          . It keeps that access until you disconnect it in Settings.
        </>
      }
    >
      {/* An app names itself, and anything can call itself anything; where
          it sends the person back is the one thing it cannot invent. */}
      <p className="text-xs text-muted-foreground">
        It will send you back to{" "}
        <code className="font-mono text-foreground">
          {new URL(asked.request.redirectUri).host}
        </code>
      </p>
      <form action="/oauth/approve" method="post" className="flex gap-2">
        {[...params].map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <Button type="submit" name="decision" value="deny" variant="outline">
          Deny
        </Button>
        <Button type="submit" name="decision" value="allow">
          Allow
        </Button>
      </form>
      {others.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Or connect it to another of your orgs
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
                <Button type="submit" variant="outline" size="sm">
                  {m.orgName}
                </Button>
              </form>
            ))}
          </div>
        </div>
      )}
    </Door>
  );
}
