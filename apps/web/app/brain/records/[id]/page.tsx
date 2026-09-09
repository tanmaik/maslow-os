import {
  aliasesOf,
  edgesOf,
  get,
  graph,
  stubs,
  isId,
  sharesOf,
  type BrainRecord,
  type Edge,
  type Stub,
} from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { groupsIn } from "@maslow/db/groups";
import { XIcon } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FormDialog } from "@/components/form-dialog";
import { HowSure } from "@/components/how-sure";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { principal } from "@/lib/session";

import { vocabulary } from "../../catalog";
import { recordHref } from "../../format";
import { Sharing } from "../../sharing";
import { TypeMark } from "../../type-icon";
import { Document } from "./document";
import { OtherRecord } from "./other-record";
import { BrainGraph } from "./lazy";
import { Properties } from "./properties";

// A record with links, up to this many, has a map of them; one with more
// has the list alone.
const MAP_LIMIT = 8;

// One record as a document to read and write in place, with what it holds
// beneath: its fields, when, how sure, the records it is linked to, and who
// may see it.
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { id } = await params;
  if (!isId(id)) notFound();
  const [{ types, people }, found] = await Promise.all([
    vocabulary(p),
    asPerson(p, async (db) => {
      const [record] = await get(db, [id]);
      if (!record) return null;
      // The live record at the end of the chain of merges, if this is not it.
      let winner = record.mergedInto
        ? (await get(db, [record.mergedInto]))[0]
        : undefined;
      while (winner?.mergedInto) {
        winner = (await get(db, [winner.mergedInto]))[0];
      }
      // The links and the map are the live record's: this one and
      // everything merged with it, the winner included, so a link's other
      // end is never one of them.
      const live = winner?.id ?? id;
      const aliases = new Set(await aliasesOf(db, live));
      const edges = await edgesOf(db, live);
      const others = await stubs(
        db,
        [...new Set(edges.flatMap((e) => [e.fromId, e.toId]))].filter(
          (x) => !aliases.has(x),
        ),
      );
      return {
        record,
        aliases,
        edges,
        others: new Map(others.map((r) => [r.id, r])),
        winner,
        near:
          edges.length > 0 && edges.length <= MAP_LIMIT
            ? await graph(db, [live])
            : null,
        shares: await sharesOf(db, { record: id }),
        groups: await groupsIn(db),
      };
    }),
  ]);
  if (!found) notFound();
  const {
    record: r,
    aliases,
    edges,
    others,
    winner,
    near,
    shares,
    groups,
  } = found;
  const type = types.find((t) => t.name === r.type && t.ownerId === r.ownerId);
  const canEdit = (r.access === "edit" || r.access === "owner") && !r.deletedAt;
  const isOwner = r.access === "owner";
  const action = `${recordHref(r.id)}/change`;
  const ownerName =
    r.ownerId === p.userId
      ? "you"
      : (people.get(r.ownerId) ?? "someone no longer here");

  return (
    <Card className="grid gap-0 gap-x-8 gap-y-5 rounded-[14px] p-4 sm:p-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-w-0 space-y-5">
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <TypeMark
            type={r.type}
            owner={r.ownerId === p.userId ? undefined : r.ownerId}
            className="text-foreground/85"
          />
          <span>·</span>
          <span>{ownerName === "you" ? "yours" : `${ownerName}'s`}</span>
        </p>
        {r.mergedInto && (
          <p className="text-muted-foreground border-l-2 pl-3 text-sm">
            Merged into{" "}
            <Link
              href={recordHref(winner?.id ?? r.mergedInto)}
              className="underline"
            >
              {winner?.title || r.mergedInto}
            </Link>
            .
          </p>
        )}
        {r.deletedAt && !r.mergedInto && (
          <p className="text-muted-foreground border-l-2 pl-3 text-sm">
            Deleted.
          </p>
        )}
        <Document id={r.id} title={r.title} body={r.body} canEdit={canEdit} />
        <Properties
          id={r.id}
          fields={type?.properties ?? []}
          values={r.props}
          occurredAt={r.occurredAt?.toISOString() ?? null}
          confidence={r.confidence}
          canEdit={canEdit}
        />
      </div>
      <div className="min-w-0 space-y-5">
        <Links
          record={r}
          aliases={aliases}
          edges={edges}
          others={others}
          people={people}
          me={p.userId}
          action={action}
          canEdit={canEdit}
        >
          {near && (
            <div className="h-64 overflow-hidden rounded-[10px] border">
              <BrainGraph graph={near} focus={winner?.id ?? r.id} />
            </div>
          )}
        </Links>
        <section className="space-y-2">
          <Heading>Who can see it</Heading>
          <Sharing
            on={{ record: r.id }}
            owner={isOwner && !r.deletedAt}
            ownerName={ownerName}
            shares={shares}
            groups={groups}
            members={[...people].map(([id, name]) => ({ id, name }))}
          />
        </section>
        {isOwner && (
          <form action={action} method="post" className="flex justify-end">
            {r.mergedInto ? (
              <Button
                type="submit"
                variant="outline"
                size="sm"
                name="intent"
                value="unmerge"
                className="rounded-full"
              >
                Unmerge
              </Button>
            ) : r.deletedAt ? (
              <Button
                type="submit"
                variant="outline"
                size="sm"
                name="intent"
                value="restore"
                className="rounded-full"
              >
                Restore
              </Button>
            ) : (
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                name="intent"
                value="delete"
                className="text-muted-foreground rounded-full"
              >
                Delete
              </Button>
            )}
          </form>
        )}
      </div>
    </Card>
  );
}

// A section's title.
const Heading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-muted-foreground text-[11px] tracking-[0.04em] uppercase">
    {children}
  </h2>
);

// The records this one is linked to, or anything merged into it is: one
// chip per link, named after the other record, with whose it is when it is
// a colleague's, and a way to add or take away a link. The map, when there
// is one, sits beneath.
function Links({
  record,
  aliases,
  edges,
  others,
  people,
  me,
  action,
  canEdit,
  children,
}: {
  record: BrainRecord;
  aliases: Set<string>;
  edges: Edge[];
  others: Map<string, Stub>;
  people: Map<string, string>;
  me: string;
  action: string;
  canEdit: boolean;
  children?: React.ReactNode;
}) {
  // Whose a linked record is, when it is not the reader's own.
  const whose = (r?: Stub) =>
    !r || r.ownerId === me
      ? null
      : `${people.get(r.ownerId) ?? "someone no longer here"}'s`;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <Heading>Relevant records</Heading>
        {canEdit && <LinkForm record={record} />}
      </div>
      {edges.length === 0 && (
        <p className="text-muted-foreground text-sm">Linked to nothing yet.</p>
      )}
      <ul className="flex flex-wrap gap-1.5 text-sm">
        {edges.map((e) => {
          const otherId = aliases.has(e.fromId) ? e.toId : e.fromId;
          const other = others.get(otherId);
          return (
            <li
              key={e.id}
              className="bg-muted/60 flex h-8 items-center gap-1.5 rounded-full pl-3 pr-1.5"
            >
              <Link
                href={recordHref(otherId)}
                className="max-w-64 truncate font-medium hover:underline"
              >
                {aliases.has(otherId)
                  ? `this ${record.type}`
                  : other?.title || "(untitled)"}
              </Link>
              {whose(other) && (
                <span className="text-muted-foreground text-[11.5px]">
                  {whose(other)}
                </span>
              )}
              {canEdit ? (
                <form action={action} method="post" className="flex">
                  <input type="hidden" name="edge" value={e.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="icon-xs"
                    name="intent"
                    value="unlink"
                    aria-label="Unlink"
                    className="text-muted-foreground rounded-full"
                  >
                    <XIcon />
                  </Button>
                </form>
              ) : (
                <span className="w-1" />
              )}
            </li>
          );
        })}
      </ul>
      {children}
    </section>
  );
}

// A new link from or to this record, under any verb.
function LinkForm({ record }: { record: BrainRecord }) {
  return (
    <FormDialog
      trigger="Link"
      title="Link to another record"
      description="A link is a sentence: this record, a verb, another record."
      variant="ghost"
    >
      <form
        action={`${recordHref(record.id)}/link`}
        method="post"
        className="grid gap-3"
      >
        <div className="space-y-1">
          <Label htmlFor="direction">Reads as</Label>
          <Select name="direction" defaultValue="out">
            <SelectTrigger id="direction" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="out">
                this {record.type} … the other
              </SelectItem>
              <SelectItem value="in">the other … this {record.type}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="verb">Verb</Label>
          <Input id="verb" name="verb" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="other">The other record</Label>
          <OtherRecord not={record.id} name="other" />
        </div>
        <HowSure id="link-confidence" name="confidence" />
        <div>
          <Button type="submit">Link</Button>
        </div>
      </form>
    </FormDialog>
  );
}
