import {
  aliasesOf,
  edgesOf,
  get,
  graph,
  isId,
  read,
  sharesOf,
  type BrainRecord,
  type Edge,
} from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { groupsIn } from "@placeholder/db/groups";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FormDialog } from "@/components/form-dialog";
import { HowSure } from "@/components/how-sure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { principal } from "@/lib/session";

import { vocabulary } from "../../catalog";
import { recordHref, verbText } from "../../format";
import { BrainGraph } from "../../graph/lazy";
import { Split } from "../../graph/split";
import { Sharing } from "../../sharing";
import { TypeIcon, TypeMark } from "../../type-icon";
import { Document } from "./document";
import { Properties } from "./properties";

// One record as a document to read and write in place, with what it holds
// beside it under the graph around it: its fields, when, how sure, who may
// see it, and its links read as sentences.
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { id } = await params;
  if (!isId(id)) notFound();
  const [{ types, verbs, people }, found] = await Promise.all([
    vocabulary(p),
    asPerson(p, async (db) => {
      const [record] = await get(db, [id]);
      if (!record) return null;
      const aliases = new Set(await aliasesOf(db, id));
      const edges = await edgesOf(db, id);
      const others = await get(
        db,
        [...new Set(edges.flatMap((e) => [e.fromId, e.toId]))].filter(
          (x) => !aliases.has(x),
        ),
      );
      // The live record at the end of the chain of merges, if this is not it.
      let winner = record.mergedInto
        ? (await get(db, [record.mergedInto]))[0]
        : undefined;
      while (winner?.mergedInto) {
        winner = (await get(db, [winner.mergedInto]))[0];
      }
      // Every record the person can see, for the link picker.
      const all: BrainRecord[] = [];
      for (let cursor: string | null = null; ;) {
        const page = await read(db, { limit: 200, cursor });
        all.push(...page.records);
        cursor = page.cursor;
        if (!cursor) break;
      }
      return {
        record,
        aliases,
        edges,
        others: new Map(others.map((r) => [r.id, r])),
        winner,
        near: await graph(db, [id]),
        shares: await sharesOf(db, { record: id }),
        all,
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
    all,
    groups,
  } = found;
  const type = types.find((t) => t.name === r.type && t.ownerId === r.ownerId);
  const canEdit = (r.access === "edit" || r.access === "owner") && !r.deletedAt;
  const isOwner = r.access === "owner";
  const action = `${recordHref(r.id)}/change`;

  const aside = (
    <div className="space-y-6">
      <Properties
        id={r.id}
        fields={type?.properties ?? []}
        values={r.props}
        occurredAt={r.occurredAt?.toISOString() ?? null}
        confidence={r.confidence}
        canEdit={canEdit}
      />
      <Separator />
      <Sharing
        on={{ record: r.id }}
        owner={isOwner && !r.deletedAt}
        ownerName={
          r.ownerId === p.userId
            ? "you"
            : (people.get(r.ownerId) ?? "someone no longer here")
        }
        shares={shares}
        groups={groups}
        members={[...people].map(([id, name]) => ({ id, name }))}
      />
      {isOwner && (
        <form action={action} method="post">
          {r.mergedInto ? (
            <Button variant="outline" size="sm" name="intent" value="unmerge">
              Unmerge
            </Button>
          ) : r.deletedAt ? (
            <Button variant="outline" size="sm" name="intent" value="restore">
              Restore
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              name="intent"
              value="delete"
              className="text-muted-foreground"
            >
              Delete
            </Button>
          )}
        </form>
      )}
    </div>
  );

  return (
    <Split
      graph={<BrainGraph graph={near} focus={winner?.id ?? r.id} />}
      aside={aside}
      graphSize={42}
    >
      <TypeMark
        type={r.type}
        owner={r.ownerId === p.userId ? undefined : r.ownerId}
        className="text-muted-foreground text-sm"
      />
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
      <Links
        record={r}
        aliases={aliases}
        edges={edges}
        others={others}
        action={action}
        canEdit={canEdit}
        verbs={verbs}
        candidates={all}
      />
    </Split>
  );
}

// Every link touching the record, or anything merged into it, read as a
// sentence, and a way to add one.
function Links({
  record,
  aliases,
  edges,
  others,
  action,
  canEdit,
  verbs,
  candidates,
}: {
  record: BrainRecord;
  aliases: Set<string>;
  edges: Edge[];
  others: Map<string, BrainRecord>;
  action: string;
  canEdit: boolean;
  verbs: string[];
  candidates: BrainRecord[];
}) {
  const name = (id: string) =>
    aliases.has(id) ? (
      <span className="text-muted-foreground">this {record.type}</span>
    ) : (
      <Link href={recordHref(id)} className="font-medium hover:underline">
        {others.get(id)?.title || "(untitled)"}
      </Link>
    );
  return (
    <section className="space-y-2 pt-4">
      <div className="flex items-center justify-between">
        <h2 className="text-muted-foreground text-sm">Links</h2>
        {canEdit && (
          <LinkForm record={record} verbs={verbs} candidates={candidates} />
        )}
      </div>
      {edges.length === 0 && (
        <p className="text-muted-foreground text-sm">Linked to nothing yet.</p>
      )}
      <ul className="space-y-1 text-sm">
        {edges.map((e) => (
          <li key={e.id} className="group flex items-baseline gap-2">
            <span className="whitespace-normal">
              {name(e.fromId)} {verbText(e.verb)} {name(e.toId)}
            </span>
            {canEdit && (
              <form action={action} method="post" className="ml-auto">
                <input type="hidden" name="edge" value={e.id} />
                <Button
                  variant="ghost"
                  size="xs"
                  name="intent"
                  value="unlink"
                  className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  Unlink
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// A new link from or to this record, under any verb; the ones in use are
// offered.
function LinkForm({
  record,
  verbs,
  candidates,
}: {
  record: BrainRecord;
  verbs: string[];
  candidates: BrainRecord[];
}) {
  const others = candidates.filter((c) => c.id !== record.id);
  return (
    <FormDialog
      trigger="Link"
      title="Link to another record"
      description="A link is a sentence: this record, a verb, another record."
      variant="ghost"
    >
      {others.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing else to link to yet.
        </p>
      ) : (
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
                <SelectItem value="in">
                  the other … this {record.type}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="verb">Verb</Label>
            <Input
              id="verb"
              name="verb"
              list="verbs"
              placeholder="attended"
              required
            />
            <datalist id="verbs">
              {verbs.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <Label htmlFor="other">The other record</Label>
            <Select name="other" defaultValue={others[0]?.id ?? null}>
              <SelectTrigger id="other" className="w-full">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {others.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <TypeIcon type={c.type} />
                    {c.title || "(untitled)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <HowSure id="link-confidence" name="confidence" />
          <div>
            <Button type="submit">Link</Button>
          </div>
        </form>
      )}
    </FormDialog>
  );
}
