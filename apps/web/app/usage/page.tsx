import { usageOfMember, usageOfOrg, type Line } from "@placeholder/db/usage";
import { redirect } from "next/navigation";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dollars, live } from "@/lib/meter";
import { MONTH, PRICES } from "@/lib/prices";
import { principal } from "@/lib/session";

// What a quantity of a resource is, in the unit a person would say.
function amount(l: Line): string {
  if (l.unit === "second") return `${(l.quantity / 3600).toFixed(2)} hours`;
  if (l.unit === "gb_second")
    return `${(l.quantity / MONTH).toFixed(3)} GB for a month`;
  const gbMonths = l.quantity / MONTH / 1e9;
  return gbMonths >= 0.001
    ? `${gbMonths.toFixed(3)} GB for a month`
    : `${(l.quantity / MONTH / 1e6).toFixed(3)} MB for a month`;
}

const WHAT: Record<string, string> = {
  compute: "Machine running",
  rootfs: "Machine's image, while off",
  disk: "Disk",
  bucket: "Bucket: uploads in transit and backups",
  brain: "Brain: records and links",
};

const PRICE: Record<string, string> = {
  compute: `$${(PRICES.compute["shared-cpu-1x:1024"]! * 3600).toFixed(4)} an hour`,
  rootfs: "$0.15 per GB a month",
  disk: "$0.15 per GB a month",
  bucket: "$0.02 per GB a month",
  brain: "$0.35 per GB a month",
};

// Exactly what this member, and for an owner the whole org, has used this
// month and what it costs at the vendors' list prices; what is ticking now;
// and what the month will come to at this rate. Nobody is billed yet.
export default async function Usage() {
  const p = await principal();
  if (!p) redirect("/");
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const monthEnd = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  const [mine, org, ticking] = await Promise.all([
    usageOfMember(p, monthStart),
    p.role === "owner" ? usageOfOrg(p, monthStart) : null,
    live(p, now),
  ]);
  const projected =
    ticking.month +
    (ticking.ratePerHour * (monthEnd - now.getTime())) / 3600_000;
  const byMember = new Map<string, { name: string; cost: number }>();
  for (const l of org ?? [])
    byMember.set(l.userId, {
      name: l.name ?? "a past member",
      cost: (byMember.get(l.userId)?.cost ?? 0) + l.cost,
    });

  return (
    <main className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-muted-foreground">
          Exactly what you have used since{" "}
          {monthStart.toISOString().slice(0, 10)}, at what Fly, Tigris and Neon
          charge us. Nobody is billed yet.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">Right now</h2>
        {ticking.active.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing is ticking.</p>
        ) : (
          <Table>
            <TableBody>
              {ticking.active.map((a) => (
                <TableRow key={a.resource} data-ticking={a.resource}>
                  <TableCell>{a.what}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {dollars(a.ratePerHour)}/h
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">All together</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {dollars(ticking.ratePerHour)}/h
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
        <p className="text-sm" data-projection={projected}>
          {`${dollars(ticking.month)} so far this month. At this rate, about ${dollars(projected)} by the end of it.`}
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">This month, yours</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>What</TableHead>
              <TableHead>How much</TableHead>
              <TableHead>Price</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mine.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Nothing yet.
                </TableCell>
              </TableRow>
            )}
            {mine.map((l) => (
              <TableRow key={`${l.resource}-${l.unit}`} data-usage={l.resource}>
                <TableCell>{WHAT[l.resource] ?? l.resource}</TableCell>
                <TableCell>{amount(l)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {PRICE[l.resource]}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {dollars(l.cost)}
                </TableCell>
              </TableRow>
            ))}
            {mine.length > 0 && (
              <TableRow>
                <TableCell colSpan={3} className="font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {dollars(mine.reduce((n, l) => n + l.cost, 0))}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      {org && (
        <section className="space-y-2">
          <h2 className="font-medium">This month, everyone in the org</h2>
          <Table>
            <TableBody>
              {[...byMember.entries()].map(([id, m]) => (
                <TableRow key={id} data-member-usage={id}>
                  <TableCell>{m.name}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {dollars(m.cost)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">Org total</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {dollars(org.reduce((n, l) => n + l.cost, 0))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </section>
      )}
    </main>
  );
}
