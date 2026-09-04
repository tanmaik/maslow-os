import { asOrg } from "@placeholder/db";
import { orgs } from "@placeholder/db/seed";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deployment } from "@/lib/deployment";
import { pendingFlow, principal } from "@/lib/session";

type Member = { id: string; name: string; email: string };

// The signed-in person's org: who is in it, who is invited, and a way to
// invite more. Signed out, a way in.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const p = await principal();
  if (!p) return <SignIn wrongCode={(await searchParams).code === "wrong"} />;

  const { orgName, members, invited } = await asOrg(p.orgId, async (q) => ({
    orgName: (await q.query<{ name: string }>("select name from orgs")).rows[0]
      ?.name,
    members: (
      await q.query<Member>("select id, name, email from users order by name")
    ).rows,
    invited: (
      await q.query<{ email: string }>(
        "select email from invitations where accepted_at is null order by created_at",
      )
    ).rows,
  }));
  const me = members.find((m) => m.id === p.userId);

  return (
    <main className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{orgName}</h1>
        <form action="/auth/sign-out" method="post">
          <Button variant="ghost" size="sm" type="submit">
            Sign out, {me?.name}
          </Button>
        </form>
      </header>

      <section className="space-y-2">
        <p>{members.length} members</p>
        <ul>
          {members.map((m) => (
            <li key={m.id}>
              {m.name} <span className="text-muted-foreground">{m.email}</span>
            </li>
          ))}
        </ul>
      </section>

      {invited.length > 0 && (
        <section className="space-y-2">
          <p>Invited, not yet signed in</p>
          <ul className="text-muted-foreground">
            {invited.map((i) => (
              <li key={i.email}>{i.email}</li>
            ))}
          </ul>
        </section>
      )}

      <form action="/invite" method="post" className="space-y-2">
        <div className="flex gap-2">
          <Input
            name="email"
            type="email"
            required
            placeholder="colleague@example.com"
          />
          <Button type="submit">Invite</Button>
        </div>
        {deployment.mail.kind === "none" && (
          <p className="text-muted-foreground text-sm">
            No mail is configured, so tell them yourself: they sign in with this
            address and they&apos;re in.
          </p>
        )}
      </form>
    </main>
  );
}

async function SignIn({ wrongCode }: { wrongCode: boolean }) {
  const { identity } = deployment;

  if (identity.kind === "workos") {
    const flow = await pendingFlow();
    const email = flow && "email" in flow ? flow.email : null;
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
            {wrongCode && (
              <p className="text-destructive text-sm">
                That code didn&apos;t work. Try again or start over.
              </p>
            )}
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

  if (identity.kind === "oidc") {
    return (
      <main className="space-y-4">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <Button render={<a href="/auth/sign-in" />}>
          Continue with {new URL(identity.issuer).host}
        </Button>
      </main>
    );
  }

  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold">Development sign-in</h1>
      <p className="text-muted-foreground">Pick a seeded person.</p>
      {orgs.map((o) => (
        <section key={o.id} className="space-y-1">
          <h2 className="font-medium">{o.name}</h2>
          <div className="flex flex-wrap gap-2">
            {o.users.map((u) => (
              <form key={u.id} action="/auth/dev" method="post">
                <input type="hidden" name="user" value={u.id} />
                <Button variant="outline" size="sm" type="submit">
                  {u.name}
                </Button>
              </form>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
