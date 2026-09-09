import type { Agent } from "@maslow/db/auth";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

// The agents the signed-in person let into their brain, and a way to end
// each one's access.
export function Agents({
  agents,
  said,
}: {
  agents: Agent[];
  said: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents</CardTitle>
        <CardDescription>
          Claude and other apps you connected to your brain. Each reads and
          writes as you, in this org, until you disconnect it. Connect one by
          adding this site&apos;s <code>/mcp</code> as an MCP server.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {agents.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing connected.</p>
        ) : (
          <Table>
            <TableBody>
              {agents.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <p>{a.client}</p>
                    <p className="text-muted-foreground text-sm">
                      since {a.createdAt.toISOString().slice(0, 10)}
                    </p>
                  </TableCell>
                  <TableCell className="text-right">
                    <form action="/settings/agents" method="post">
                      <input type="hidden" name="session" value={a.id} />
                      <Button variant="outline" size="sm" type="submit">
                        Disconnect
                      </Button>
                    </form>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {said && <p className="text-sm">{said}</p>}
      </CardContent>
    </Card>
  );
}
