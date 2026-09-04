import { orgs } from "@placeholder/db/seed";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

const seeded = orgs.flatMap((o) =>
  o.users.map((u, i) => ({
    ...u,
    org: o.name,
    role: i === 0 ? "owner" : "member",
  })),
);

// Everything a developer wants to know and do on a deployment that is not
// production: where they are, what is real, who they are, and one click to be
// someone else. Renders nothing in production.
export async function DevToolbar() {
  if (deployment.production) return null;
  const p = await principal();
  const me = p && seeded.find((u) => u.id === p.userId);
  const where = process.env.VERCEL ? "preview" : "local";
  const real = {
    identity: deployment.identity.kind !== "dev",
    mail: deployment.mail.kind !== "none",
    storage: deployment.storage.kind !== "none",
  };

  return (
    <div className="bg-background/95 fixed inset-x-0 bottom-0 z-50 border-t backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-1.5 text-xs">
        <Badge variant="outline">{where}</Badge>
        {Object.entries(real).map(([k, v]) => (
          <span key={k} className={v ? "" : "text-muted-foreground"}>
            {k} {v ? "real" : "faked"}
          </span>
        ))}
        <span className="flex-1" />
        {p ? (
          <span className="text-muted-foreground">
            {me
              ? `${me.name} · ${me.role} of ${me.org}`
              : "signed in as yourself"}
          </span>
        ) : (
          <span className="text-muted-foreground">signed out</span>
        )}
        <Popover>
          <PopoverTrigger render={<Button variant="outline" size="xs" />}>
            Switch person
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 space-y-3">
            {orgs.map((o) => (
              <div key={o.id} className="space-y-1">
                <p className="text-muted-foreground text-xs">{o.name}</p>
                <div className="flex flex-wrap gap-1">
                  {o.users.map((u, i) => (
                    <form key={u.id} action="/auth/dev" method="post">
                      <input type="hidden" name="user" value={u.id} />
                      <Button
                        variant={p?.userId === u.id ? "secondary" : "ghost"}
                        size="xs"
                        type="submit"
                      >
                        {u.name}
                        {i === 0 && (
                          <span className="text-muted-foreground ml-1">
                            owner
                          </span>
                        )}
                      </Button>
                    </form>
                  ))}
                </div>
              </div>
            ))}
            {p && (
              <form action="/auth/sign-out" method="post">
                <Button variant="ghost" size="xs" type="submit">
                  Sign out
                </Button>
              </form>
            )}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
