import {
  aliasesOf,
  catalog,
  edgesOf,
  get,
  grantsOf,
  graph,
  history,
  isId,
  read,
  type BrainRecord,
  type Edge,
  type Event,
  type Verb,
} from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { groupsOf } from "@placeholder/db/groups";
import { notFound, redirect } from "next/navigation";

import { DateField } from "@/components/date-field";
import { FormDialog } from "@/components/form-dialog";
import { HowSure } from "@/components/how-sure";
import { LocalTime } from "@/components/local-time";
import { Markdown } from "@/components/markdown";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { principal } from "@/lib/session";

import { FieldInputs } from "../../fields";
import {
  authorText,
  cell,
  percent,
  recordHref,
  sourceText,
  verbText,
} from "../../format";
import { BrainGraph } from "../../graph/lazy";
import { Split } from "../../graph/split";
import { KindIcon, KindMark } from "../../kind-icon";
import { peopleOf } from "../../people";
import { Sharing } from "../../sharing";
import { TypeBadge } from "../../type-badge";

// One record as a page to read: its body, with everything about it beside
// the graph around it: fields, origin, links read as sentences, history,
// and the ways to change it.
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { id } = await params;
  if (!isId(id)) notFound();
  const found = await asPerson(p, async (db) => {
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
      const page = await read(db, { scope: "all", limit: 200, cursor });
      all.push(...page.records);
      cursor = page.cursor;
      if (!cursor) break;
    }
    const vocabulary = await catalog(db);
    return {
      record,
      aliases,
      edges,
      others: new Map(others.map((r) => [r.id, r])),
      winner,
      kind: vocabulary.kinds.find(
        (k) => k.name === record.kind && k.ownerId === record.ownerId,
      ),
      verbs: vocabulary.verbs,
      events: await history(db, { of: id }),
      near: await graph(db, [id]),
      grants: await grantsOf(db, { record: id }),
      all,
      people: await peopleOf(db),
    };
  });
  if (!found) notFound();
  const groups = await groupsOf(p);
  const {
    record: r,
    aliases,
    edges,
    others,
    winner,
    kind,
    verbs,
    events,
    near,
    grants,
    all,
    people,
  } = found;
  const canEdit = r.access === "edit" || r.access === "owner";
  const isOwner = r.access === "owner";
  const who = (author: string) => authorText(author, people);
  const properties = kind?.properties ?? [];
  const undeclared = Object.keys(r.props).filter(
    (k) => !properties.some((f) => f.name === k),
  );
  const action = `${recordHref(r.id)}/change`;

  const details = (
    <>
      <Table>
        <TableBody>
          {properties.map((f) => (
            <TableRow key={f.id}>
              <TableHead className="w-44" title={f.description}>
                <span className="inline-flex items-center gap-1.5">
                  {f.name}
                  <TypeBadge type={f.type} />
                </span>
              </TableHead>
              <TableCell className="whitespace-normal">
                {cell(r.props[f.name], f)}
              </TableCell>
            </TableRow>
          ))}
          {undeclared.map((k) => (
            <TableRow key={k}>
              <TableHead className="w-44">{k}</TableHead>
              <TableCell className="whitespace-normal">
                {cell(r.props[k])}
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableHead className="w-44">
              <span className="inline-flex items-center gap-1.5">
                When
                <TypeBadge type="datetime" />
              </span>
            </TableHead>
            <TableCell className="text-muted-foreground">
              <LocalTime at={r.occurredAt} fallback="no time" />
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead title="Where this came from and who wrote it">
              <span className="inline-flex items-center gap-1.5">
                Origin
                <TypeBadge type="text" />
              </span>
            </TableHead>
            <TableCell className="whitespace-normal">
              {r.layer === "derived" ? (
                <>
                  concluded by {who(r.author)}
                  {r.confidence !== null && `, ${percent(r.confidence)} sure`}
                </>
              ) : (
                <>
                  {sourceText(r.source, r.sourceRef)}, by {who(r.author)}
                </>
              )}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableHead title="When this record was made and last changed">
              <span className="inline-flex items-center gap-1.5">
                Changed
                <TypeBadge type="datetime" />
              </span>
            </TableHead>
            <TableCell className="text-muted-foreground whitespace-normal">
              made <LocalTime at={r.createdAt} />
              {r.version > 1 && (
                <>
                  , last changed <LocalTime at={r.updatedAt} />
                </>
              )}
              {". "}
              <a href="/brain/activity" className="underline">
                All changes to the brain
              </a>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <Sharing
        on={{ record: r.id }}
        owner={isOwner}
        ownerName={people.get(r.ownerId) ?? "someone no longer here"}
        grants={grants}
        groups={groups}
        members={[...people].map(([id, name]) => ({ id, name }))}
      />

      {!r.deletedAt && canEdit && (
        <div className="flex flex-wrap gap-2">
          <FormDialog trigger="Edit" title={`Edit ${r.title || "this record"}`}>
            <form action={action} method="post" className="grid gap-3">
              <input type="hidden" name="version" value={r.version} />
              <div className="space-y-1">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  name="title"
                  defaultValue={r.title}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="body">Body, markdown</Label>
                <Textarea
                  id="body"
                  name="body"
                  defaultValue={r.body}
                  rows={8}
                />
              </div>
              <FieldInputs properties={properties} values={r.props} />
              <div className="space-y-1">
                <Label htmlFor="occurred_at">When</Label>
                <DateField
                  id="occurred_at"
                  name="occurred_at"
                  time
                  defaultValue={r.occurredAt?.toISOString()}
                />
              </div>
              {r.layer === "derived" && (
                <HowSure
                  id="confidence"
                  name="confidence"
                  defaultValue={
                    r.confidence === null
                      ? null
                      : Math.round(r.confidence * 100)
                  }
                />
              )}
              <div>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </FormDialog>
          <LinkForm record={r} verbs={verbs} candidates={all} />
        </div>
      )}

      <Links
        record={r}
        aliases={aliases}
        edges={edges}
        others={others}
        action={action}
        canEdit={canEdit && !r.deletedAt}
      />
      <History events={events} who={who} />
    </>
  );

  return (
    <Split
      graph={<BrainGraph graph={near} focus={winner?.id ?? r.id} />}
      aside={details}
      graphSize={45}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-semibold">{r.title || "(untitled)"}</h1>
          <KindMark
            kind={r.kind}
            owner={r.ownerId === p.userId ? undefined : r.ownerId}
            className="text-muted-foreground text-sm"
          />
        </div>
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
              <Button variant="ghost" size="sm" name="intent" value="delete">
                Delete
              </Button>
            )}
          </form>
        )}
      </div>

      {r.mergedInto && (
        <p className="text-muted-foreground border-l-2 pl-3 text-sm">
          Merged into{" "}
          <a
            href={recordHref(winner?.id ?? r.mergedInto)}
            className="underline"
          >
            {winner?.title || r.mergedInto}
          </a>
          . Reads follow the pointer; unmerging brings this one back.
        </p>
      )}
      {r.deletedAt && !r.mergedInto && (
        <p className="text-muted-foreground border-l-2 pl-3 text-sm">
          Deleted <LocalTime at={r.deletedAt} />. Its history stays.
        </p>
      )}

      {r.body ? (
        <Markdown>{r.body}</Markdown>
      ) : (
        <p className="text-muted-foreground text-sm">
          Nothing written here yet. Edit to add a body.
        </p>
      )}
    </Split>
  );
}

// Every link touching the record, or anything merged into it, read as a
// sentence: who did what to whom.
function Links({
  record,
  aliases,
  edges,
  others,
  action,
  canEdit,
}: {
  record: BrainRecord;
  aliases: Set<string>;
  edges: Edge[];
  others: Map<string, BrainRecord>;
  action: string;
  canEdit: boolean;
}) {
  const name = (id: string) =>
    aliases.has(id) ? (
      <span className="text-muted-foreground">this {record.kind}</span>
    ) : (
      <a href={recordHref(id)} className="font-medium hover:underline">
        {others.get(id)?.title || "(untitled)"}
      </a>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Links</TableHead>
          <TableHead>How sure</TableHead>
          <TableHead>When</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {edges.map((e) => (
          <TableRow key={e.id}>
            <TableCell className="whitespace-normal">
              {name(e.fromId)} {verbText(e.verb)} {name(e.toId)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {percent(e.confidence)}
            </TableCell>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              <LocalTime at={e.occurredAt ?? e.createdAt} />
            </TableCell>
            <TableCell className="text-right">
              {canEdit && (
                <form action={action} method="post">
                  <input type="hidden" name="edge" value={e.id} />
                  <Button
                    variant="ghost"
                    size="xs"
                    name="intent"
                    value="unlink"
                  >
                    Unlink
                  </Button>
                </form>
              )}
            </TableCell>
          </TableRow>
        ))}
        {edges.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="text-muted-foreground">
              Linked to nothing yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

// A new link from or to this record, on one of the person's own verbs.
function LinkForm({
  record,
  verbs,
  candidates,
}: {
  record: BrainRecord;
  verbs: Verb[];
  candidates: BrainRecord[];
}) {
  const others = candidates.filter((c) => c.id !== record.id);
  return (
    <FormDialog
      trigger="Link"
      title="Link to another record"
      description="A link is a sentence: this record, a verb, another record."
    >
      {verbs.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          A link needs a verb. Define one in{" "}
          <a href="/brain/vocabulary" className="underline">
            vocabulary
          </a>
          .
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
                  this {record.kind} … the other
                </SelectItem>
                <SelectItem value="in">
                  the other … this {record.kind}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="verb">Verb</Label>
            <Select name="verb" defaultValue={verbs[0]!.name}>
              <SelectTrigger id="verb" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {verbs.map((v) => (
                  <SelectItem key={v.id} value={v.name}>
                    {verbText(v.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                    <KindIcon kind={c.kind} />
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

function History({
  events,
  who,
}: {
  events: Event[];
  who: (author: string) => string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>History</TableHead>
          <TableHead />
          <TableHead>By</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => (
          <TableRow key={e.seq}>
            <TableCell className="text-muted-foreground whitespace-nowrap">
              <LocalTime at={e.at} />
            </TableCell>
            <TableCell>{e.action}</TableCell>
            <TableCell className="text-muted-foreground whitespace-normal">
              {who(e.author)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
