import { asOrg } from "@placeholder/db";
import { membershipsOf } from "@placeholder/db/auth";

import { Button } from "@/components/ui/button";
import { principal } from "@/lib/session";

// The one header on every signed-in screen: the org, the other orgs the
// person belongs to, and the way to the brain, settings and out.
export async function AppHeader() {
  const p = await principal();
  if (!p) return null;
  const { orgName, me } = await asOrg(p.orgId, async (q) => ({
    orgName: (await q.query<{ name: string }>("select name from orgs")).rows[0]
      ?.name,
    me: (
      await q.query<{ name: string }>("select name from users where id = $1", [
        p.userId,
      ])
    ).rows[0]?.name,
  }));
  const others = (await membershipsOf(p)).filter((m) => m.userId !== p.userId);

  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <a href="/" className="px-2 text-base font-semibold">
          {orgName}
        </a>
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
      </div>
      <nav className="flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<a href="/computer" />}
        >
          Computer
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<a href="/brain" />}
        >
          Brain
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<a href="/settings" />}
        >
          Settings
        </Button>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<a href="/usage" />}
        >
          Usage
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
