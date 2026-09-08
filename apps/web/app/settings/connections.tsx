import type { App } from "@/lib/composio";
import type { Connection } from "@/lib/connections";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Item,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { initials } from "@/lib/initials";

import { AccountName } from "./account-name";
import { Finder } from "./finder";

// The apps the signed-in person has connected, as the vendor has them right
// now, each account under its app with the name the person gave it, and a
// way to connect more. Null for either list means the vendor did not
// answer.
export function Connections({
  enabled,
  connections,
  mostUsed,
  focus,
  said,
}: {
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
    <Card>
      <CardHeader>
        <CardTitle>Connected apps</CardTitle>
        <CardDescription>
          Your accounts in outside apps, for the agent to read as you. Nobody
          else in the org sees them. Hold more than one account in an app and
          name each so you and the agent can tell them apart.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
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
                <ItemGroup className="gap-2">
                  {[...apps.entries()].map(([slug, accounts]) => (
                    <Item
                      key={slug}
                      variant="outline"
                      className="items-start"
                      data-app={slug}
                    >
                      <ItemMedia>
                        <Avatar className="size-8 rounded-md">
                          {accounts[0]!.logo && (
                            <AvatarImage src={accounts[0]!.logo} alt="" />
                          )}
                          <AvatarFallback className="rounded-md">
                            {initials(accounts[0]!.appName)}
                          </AvatarFallback>
                        </Avatar>
                      </ItemMedia>
                      <ItemContent className="gap-2">
                        <ItemTitle>{accounts[0]!.appName}</ItemTitle>
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
                              <input
                                type="hidden"
                                name="account"
                                value={c.id}
                              />
                              <Button variant="ghost" size="sm" type="submit">
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
                            size="sm"
                            type="submit"
                            className="text-muted-foreground h-auto px-0"
                          >
                            Add another {accounts[0]!.appName} account
                          </Button>
                        </form>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              )
            )}
            <Finder mostUsed={mostUsed} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
