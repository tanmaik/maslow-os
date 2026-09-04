import { asOrg } from "@placeholder/db";
import { membershipsOf } from "@placeholder/db/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deployment } from "@/lib/deployment";
import { pendingFlow, principal } from "@/lib/session";

type Member = { id: string; name: string; email: string };

// What the last action left to say, by the query it redirected with.
type Notice = {
  email?: "slow" | "rejected";
  code?: "wrong" | "locked";
  signin?: "cancelled";
};

const NOTICES = {
  "email=slow": "Too many codes asked for. Wait ten minutes and try again.",
  "email=rejected": "That address was refused. Check it and try again.",
  "code=wrong": "That code didn't work. Try again or start over.",
  "code=locked": "Too many wrong codes. Ask for a new one.",
  "signin=cancelled": "Sign-in was cancelled.",
} as const;

// The one line the last action left behind, if any.
function notice(n: Notice): string | null {
  for (const [k, v] of Object.entries(n))
    if (`${k}=${v}` in NOTICES)
      return NOTICES[`${k}=${v}` as keyof typeof NOTICES];
  return null;
}

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

  const memberships = await membershipsOf(p);
  const others = memberships.filter((m) => m.userId !== p.userId);

  return (
    <main className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">{orgName}</h1>
          {others.length > 0 && (
            <form action="/auth/switch" method="post" className="flex gap-1">
              {others.map((m) => (
                <Button
                  key={m.userId}
                  variant="ghost"
                  size="sm"
                  type="submit"
                  name="membership"
                  value={m.userId}
                >
                  {m.orgName}
                </Button>
              ))}
            </form>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            render={<a href="/brain" />}
            nativeButton={false}
          >
            Brain
          </Button>
          <Button
            variant="ghost"
            size="sm"
            render={<a href="/settings" />}
            nativeButton={false}
          >
            Settings
          </Button>
          <form action="/auth/sign-out" method="post">
            <Button variant="ghost" size="sm" type="submit">
              Sign out, {me?.name}
            </Button>
          </form>
        </div>
      </header>
      <p className="text-muted-foreground">
        {members} {members === 1 ? "member" : "members"}. Invite people and
        manage the org in{" "}
        <a href="/settings" className="underline">
          settings
        </a>
        .
      </p>
    </main>
  );
}

async function SignIn({ said }: { said: string | null }) {
  const { identity } = deployment;

  if (identity.kind === "workos") {
    const flow = await pendingFlow();
    const email = flow?.email ?? null;
    return (
      <main className="space-y-4">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        {email ? (
          <>
            {deployment.mail.kind === "none" ? (
              <p className="text-muted-foreground border-l-2 pl-3 text-sm">
                No mail is configured: the code for {email} is in the server's
                terminal.
              </p>
            ) : (
              <p>
                Enter the six-digit code sent to{" "}
                <span className="font-medium">{email}</span>.
              </p>
            )}
            <form action="/auth/code" method="post" className="flex gap-2">
              <Input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
                autoFocus
                placeholder="000000"
                className="max-w-32"
              />
              <Button type="submit">Continue</Button>
            </form>
            {said && <p className="text-destructive text-sm">{said}</p>}
            <form action="/auth/restart" method="post">
              <Button variant="link" size="sm" type="submit" className="px-0">
                Use a different email
              </Button>
            </form>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              We&apos;ll email you a six-digit code. No password, no account to
              make.
            </p>
            {said && <p className="text-destructive text-sm">{said}</p>}
            <form action="/auth/email" method="post" className="flex gap-2">
              <Input
                name="email"
                type="email"
                required
                autoFocus
                placeholder="you@example.com"
              />
              <Button type="submit">Continue</Button>
            </form>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-muted-foreground">
        No identity provider is configured. Pick a person from the pill in the
        corner.
      </p>
      {said && <p className="text-destructive text-sm">{said}</p>}
    </main>
  );
}
