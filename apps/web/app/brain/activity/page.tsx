import { history, type Event } from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { principal } from "@/lib/session";

import { LocalTime } from "@/components/local-time";

import { authorText, recordHref } from "../format";

const PAGE = 50;

// The log's subjects in the words the interface uses.
const SUBJECTS: Record<Event["subject"], string> = {
  record: "record",
  edge: "link",
  type: "type",
  verb: "verb",
  property: "field",
  share: "share",
  member: "member",
};

// What an event was about, from the row it left behind.
function subjectOf(e: Event): { label: string; href?: string } {
  const row = (e.after ?? e.before) as Record<string, unknown> | null;
  const name = (k: string) => (row?.[k] ? String(row[k]) : "");
  switch (e.subject) {
    case "record":
      return {
        label: name("title") || "(untitled)",
        href: recordHref(e.subjectId),
      };
    case "edge":
      return { label: name("verb") };
    case "property":
      return { label: `${name("type")}.${name("name")}` };
    case "share": {
      const to =
        name("subject") === "group"
          ? `group ${name("group")}`
          : name("subject") === "member"
            ? "a colleague"
            : "everyone";
      const what = name("type") ? `type ${name("type")}` : name("record");
      return {
        label: `${what} to ${to} at ${name("level")}`,
        href: name("record_id") ? recordHref(name("record_id")) : undefined,
      };
    }
    case "member":
      return { label: `${name("name")}, ${name("role")}` };
    default:
      return { label: name("name") };
  }
}

// Every change to this brain, newest first, as the database logged it.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { before } = await searchParams;
  const seq = before && /^\d{1,15}$/.test(before) ? Number(before) : undefined;
  const { events, people } = await asPerson(p, async (db) => ({
    events: await history(db, { before: seq, limit: PAGE }),
    people: new Map(
      (
        await db.query<{ id: string; name: string }>(
          "select id, name from users",
        )
      ).rows.map((u) => [u.id, u.name]),
    ),
  }));
  const last = events.at(-1);

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-muted-foreground text-sm">
          Every change that concerns you, newest first, as the database logged
          it: your own, what colleagues did to what they shared with you, and
          who joined or left.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>What</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Which</TableHead>
            <TableHead className="hidden sm:table-cell">By</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => {
            const s = subjectOf(e);
            return (
              <TableRow key={e.seq}>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  <LocalTime at={e.at} />
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{SUBJECTS[e.subject]}</Badge>
                </TableCell>
                <TableCell>{e.action}</TableCell>
                <TableCell className="max-w-xs truncate">
                  {s.href ? (
                    <Link href={s.href} className="hover:underline">
                      {s.label}
                    </Link>
                  ) : (
                    s.label
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground hidden sm:table-cell">
                  {authorText(e.author, people)}
                </TableCell>
              </TableRow>
            );
          })}
          {events.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                Nothing has happened yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {last && events.length === PAGE && (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link href={`/brain/activity?before=${last.seq}`} />}
        >
          Older
        </Button>
      )}
    </>
  );
}
