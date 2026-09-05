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
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { initials } from "@/lib/initials";

// The apps the signed-in person has connected, as the vendor has them right
// now, and a way to connect more. Null for either means the vendor did not
// answer.
export function Connections({
  enabled,
  connections,
  query,
  found,
  said,
}: {
  enabled: boolean;
  connections: Connection[] | null;
  query: string;
  found: App[] | null;
  said: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected apps</CardTitle>
        <CardDescription>
          Your accounts in outside apps, for the agent to read as you. Nobody
          else in the org sees them. Shown as they stand right now.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enabled ? (
          <p className="text-muted-foreground text-sm">
            Connections are not set up on this deployment.
          </p>
        ) : (
          <>
            {connections === null ? (
              <p className="text-muted-foreground text-sm">
                Composio didn&apos;t answer, so your connections can&apos;t be
                shown right now. Reload to try again.
              </p>
            ) : (
              connections.length > 0 && (
                <Table>
                  <TableBody>
                    {connections.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="w-10">
                          <Avatar className="size-8">
                            <AvatarFallback>
                              {initials(c.appName)}
                            </AvatarFallback>
                          </Avatar>
                        </TableCell>
                        <TableCell>
                          <p>{c.appName}</p>
                          <p className="text-muted-foreground text-sm">
                            since {c.createdAt.toISOString().slice(0, 10)}
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={
                              c.status === "ACTIVE" ? "secondary" : "outline"
                            }
                          >
                            {c.status.toLowerCase()}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <form action="/settings/connections" method="post">
                            <input
                              type="hidden"
                              name="intent"
                              value="disconnect"
                            />
                            <input type="hidden" name="account" value={c.id} />
                            <Button variant="ghost" size="sm" type="submit">
                              Disconnect
                            </Button>
                          </form>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            )}
            <form action="/settings" method="get" className="flex gap-2">
              <Input
                name="apps"
                defaultValue={query}
                placeholder="Find an app to connect"
                aria-label="Find an app to connect"
              />
              <Button type="submit" variant="secondary">
                Find
              </Button>
            </form>
            {query && found === null && (
              <p className="text-muted-foreground text-sm">
                Composio didn&apos;t answer, so no apps can be found right now.
                Try again in a moment.
              </p>
            )}
            {query && found !== null && (
              <Table>
                <TableBody>
                  {found.map((a) => (
                    <TableRow key={a.slug}>
                      <TableCell className="w-10">
                        <Avatar className="size-8">
                          {a.logo && <AvatarImage src={a.logo} alt="" />}
                          <AvatarFallback>{initials(a.name)}</AvatarFallback>
                        </Avatar>
                      </TableCell>
                      <TableCell>
                        <p>{a.name}</p>
                        {a.description && (
                          <p className="text-muted-foreground truncate text-sm">
                            {a.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <form action="/settings/connections" method="post">
                          <input type="hidden" name="intent" value="connect" />
                          <input type="hidden" name="app" value={a.slug} />
                          <Button size="sm" type="submit">
                            Connect
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                  {found.length === 0 && (
                    <TableRow>
                      <TableCell className="text-muted-foreground">
                        No app matches &ldquo;{query}&rdquo;.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
            {said && <p className="text-muted-foreground text-sm">{said}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
