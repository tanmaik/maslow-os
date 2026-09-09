import { asOrg } from "@placeholder/db";
import { membershipsByEmail } from "@placeholder/db/auth";
import Link from "next/link";

import { EagerLink } from "@/components/eager-link";

import { NewOrg } from "@/components/new-org";
import { Button } from "@/components/ui/button";
import { principal } from "@/lib/session";

// The one header on every signed-in screen: the org, the other orgs the
// person belongs to, and the way to the brain, settings and out.
export async function AppHeader() {
  const p = await principal();
  if (!p) return null;
  const [{ orgName, me }, memberships] = await Promise.all([
    asOrg(p.orgId, async (q) => ({
      orgName: (await q.query<{ name: string }>("select name from orgs"))
        .rows[0]?.name,
      me: (
        await q.query<{ name: string }>(
          "select name from users where id = $1",
          [p.userId],
        )
      ).rows[0]?.name,
    })),
    membershipsByEmail(p.email),
  ]);
  const others = memberships.filter((m) => m.userId !== p.userId);

  return (
    <header className="mb-6 flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <div className="flex items-center gap-1">
        <Link href="/" className="px-2 text-base font-semibold">
          {orgName}
        </Link>
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
                className="text-muted-foreground"
              >
                Switch to {m.orgName}
              </Button>
            ))}
          </form>
        )}
        <NewOrg />
      </div>
      <nav className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<EagerLink href="/computer" />}
        >
          Computer
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<EagerLink href="/brain" />}
        >
          Brain
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<EagerLink href="/settings" />}
        >
          Settings
        </Button>
        <form action="/auth/sign-out" method="post">
          <Button variant="ghost" size="sm" type="submit">
            Sign out, {me}
          </Button>
        </form>
      </nav>
    </header>
  );
}
