import type { App } from "@/lib/composio";
import type { Connection } from "@/lib/connections";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { initials } from "@/lib/initials";

import { AccountName } from "./account-name";
import { Finder } from "./finder";
import { Item } from "@/components/ui/item";
import { Section } from "./section";

// The apps the signed-in person has connected, as the vendor has them right
// now, each account under its app with the name the person gave it, and a
// way to connect more. Null for either list means the vendor did not
// answer.
export function Connections({
  orgName,
  enabled,
  connections,
  mostUsed,
  focus,
  said,
}: {
  orgName: string;
  enabled: boolean;
  connections: Connection[] | null;
  mostUsed: App[] | null;
  focus: string | null;
  said: string | null;
}) {
  const apps = new Map<string, Connection[]>();
  for (const c of connections ?? [])
    apps.set(c.app, [...(apps.get(c.app) ?? []), c]);

  return (
    <Section
      id="apps"
      title="Connected apps"
      description={`Your accounts, for your computer to act in as you. Nobody else in ${orgName} sees them. Name each account so you both can tell them apart.`}
    >
      {!enabled ? (
        <p className="text-muted-foreground text-sm">
          Connections are not set up on this deployment.
        </p>
      ) : (
        <>
          {said && <p className="text-sm">{said}</p>}
          {connections === null ? (
            <p className="text-muted-foreground text-sm">
              Composio didn&apos;t answer, so your connections can&apos;t be
              shown right now. Reload to try again.
            </p>
          ) : (
            apps.size > 0 && (
              <div className="space-y-2">
                {[...apps.entries()].map(([slug, accounts]) => (
                  <Item
                    variant="muted"
                    className="items-start rounded-[10px]"
                    key={slug}
                    data-app={slug}
                  >
                    <Avatar className="size-8 rounded-lg">
                      {accounts[0]!.logo && (
                        <AvatarImage src={accounts[0]!.logo} alt="" />
                      )}
                      <AvatarFallback className="rounded-lg text-xs font-semibold">
                        {initials(accounts[0]!.appName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 space-y-2">
                      <p className="text-sm font-medium">
                        {accounts[0]!.appName}
                      </p>
                      {accounts.map((c) => (
                        <div key={c.id} className="flex items-center gap-2">
                          <AccountName
                            account={c.id}
                            name={c.name}
                            focus={c.id === focus}
                          />
                          {c.status !== "ACTIVE" && (
                            <Badge variant="outline">
                              {c.status.toLowerCase()}
                            </Badge>
                          )}
                          <form action="/settings/connections" method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="disconnect"
                            />
                            <input type="hidden" name="account" value={c.id} />
                            <Button
                              variant="ghost"
                              size="xs"
                              type="submit"
                              className="text-muted-foreground"
                            >
                              Disconnect
                            </Button>
                          </form>
                        </div>
                      ))}
                      <form action="/settings/connections" method="post">
                        <input type="hidden" name="intent" value="connect" />
                        <input type="hidden" name="app" value={slug} />
                        <Button
                          variant="link"
                          size="xs"
                          type="submit"
                          className="text-muted-foreground h-auto px-0"
                        >
                          Add another {accounts[0]!.appName} account
                        </Button>
                      </form>
                    </div>
                  </Item>
                ))}
              </div>
            )
          )}
          <Finder mostUsed={mostUsed} />
        </>
      )}
    </Section>
  );
}
