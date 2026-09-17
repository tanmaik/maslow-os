import {
  aliasesOf,
  edgesOf,
  get,
  graph,
  history,
  stubs,
  sharesOf,
  type BrainRecord,
  type Edge,
  type Stub,
} from "@maslow/brain";
import { asPerson } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { groupsIn } from "@maslow/db/groups";
import { RiArrowLeftSLine } from "@remixicon/react";
import Link from "next/link";

import { EagerLink } from "@/components/eager-link";
import { deployment } from "@/lib/deployment";
import { cx } from "@/utils/cx";

import { vocabulary } from "../../catalog";
import { recordHref, verbText } from "../../format";
import { Sharing } from "../../sharing";
import { TypeMark } from "../../type-icon";
import { Document } from "./document";
import { Expand } from "./expand";
import { LinkForm } from "./link-form";
import { BrainGraph } from "./lazy";
import { Properties } from "./properties";
import { Unlink } from "./unlink";
import { Whole, type Act } from "./whole";

// A record with links, up to this many, has a map of them; one with more
// has the list alone.
const MAP_LIMIT = 8;

// One record with everything a page of it shows: the record, the last
// change it was read at, the links and the map of the live record at the
// end of its chain of merges, and who may see it.
export type Found = NonNullable<Awaited<ReturnType<typeof readRecord>>>;

// Reads one record as its page shows it, or null where there is none the
// reader may see.
export const readRecord = (p: Principal, id: string) =>
  asPerson(p, async (db) => {
    const [last] = await history(db, { of: id, limit: 1 });
    const [record] = await get(db, [id]);
    if (!record) return null;
    // The live record at the end of the chain of merges, if this is not it.
    let winner = record.mergedInto
      ? (await get(db, [record.mergedInto]))[0]
      : undefined;
    while (winner?.mergedInto) {
      winner = (await get(db, [winner.mergedInto]))[0];
    }
    // The links and the map are the live record's: this one and everything
    // merged with it, the winner included, so a link's other end is never
    // one of them.
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
      seen: last?.seq ?? 0,
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
  });

// One record as a document to read and write in place, with what it holds
// beneath: its fields, when, how sure, the records it is linked to, and who
// may see it. It is the record's own page, and the reading pane beside the
// list, where another record is a step away rather than a page.
export async function RecordPane({
  p,
  found,
  back,
  here,
  expand,
  hrefOf = recordHref,
}: {
  p: Principal;
  found: Found;
  // The way back to the list: where it goes, what it is called, and where
  // it shows, since beside the list there is nothing to go back to.
  back: { href: string; label: string; className?: string };
  // Where a change to the record comes back to: this view, as it stands.
  here: string;
  // Where the record opens as a whole page, when it is read beside a list.
  expand?: string;
  // Where another record opens from this one.
  hrefOf?: (id: string) => string;
}) {
  const { types, people } = await vocabulary(p);
  const {
    record: r,
    seen,
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
  const act: Act = r.mergedInto
    ? "unmerge"
    : r.deletedAt
      ? "restore"
      : "remove";

  return (
    <div className="@container flex min-h-full flex-col">
      {/* The rows hold their own height and the room left over lies under
          them, never between the record's name and its words. */}
      <div className="grid flex-1 content-start gap-x-8 gap-y-3 @2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @2xl:grid-rows-[auto_1fr]">
        <div className="col-span-full flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-2 text-caption-1-medium text-text-secondary">
            <EagerLink
              href={back.href}
              className={cx(
                "-ml-1 flex shrink-0 items-center gap-0.5 rounded-full px-1 py-0.5 transition-colors duration-fast ease-plain hover:text-text-primary",
                back.className,
              )}
            >
              <RiArrowLeftSLine className="size-3.5" aria-hidden />
              {back.label}
            </EagerLink>
            <span aria-hidden className={back.className}>
              ·
            </span>
            <TypeMark
              type={r.type}
              owner={r.ownerId === p.userId ? undefined : r.ownerId}
              className="truncate text-text-primary"
            />
            {ownerName !== "you" && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{ownerName}&apos;s</span>
              </>
            )}
          </p>
          {expand && <Expand href={expand} />}
          <Sharing
            on={{ record: r.id }}
            owner={isOwner && !r.deletedAt}
            ownerName={ownerName}
            shares={shares}
            groups={groups}
            members={[...people].map(([id, name]) => ({ id, name }))}
            pill
          />
          {isOwner && <Whole action={action} act={act} back={here} />}
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          {r.mergedInto && (
            <p className="border-l-2 border-separator-border pl-3 text-body-regular text-text-secondary">
              Merged into{" "}
              <Link
                href={hrefOf(winner?.id ?? r.mergedInto)}
                className="text-text-primary underline"
              >
                {winner?.title || r.mergedInto}
              </Link>
              .
            </p>
          )}
          {r.deletedAt && !r.mergedInto && (
            <p className="border-l-2 border-separator-border pl-3 text-body-regular text-text-secondary">
              Deleted.
            </p>
          )}
          <Document
            key={r.id}
            id={r.id}
            title={r.title}
            body={r.body}
            seen={seen}
            canEdit={canEdit}
            me={{ id: p.userId, name: people.get(p.userId) ?? "You" }}
            liveable={deployment.sync.kind !== "none"}
            fields={
              <Properties
                id={r.id}
                fields={type?.properties ?? []}
                values={r.props}
                canEdit={canEdit}
              />
            }
          />
        </div>
        {/* The right column's first heading is 12px type beside a 24px
            title, so it is dropped to the title's own cap line. */}
        <div className="flex min-w-0 flex-col gap-3 @2xl:pt-2">
          <Links
            record={r}
            aliases={aliases}
            edges={edges}
            others={others}
            people={people}
            me={p.userId}
            action={action}
            back={here}
            canEdit={canEdit}
            hrefOf={hrefOf}
          />
          {near && (
            <section className="flex flex-col gap-2">
              <Heading>Map</Heading>
              {/* A map of two or three records does not need the room a
                  crowded one does. */}
              <div
                className={`overflow-hidden rounded-2xl border border-border-button-default ${
                  near.nodes.length <= 3 ? "h-36" : "h-52"
                }`}
              >
                <BrainGraph
                  graph={near}
                  focus={winner?.id ?? r.id}
                  hrefs={Object.fromEntries(
                    near.nodes.map((n) => [n.id, hrefOf(n.id)]),
                  )}
                />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// A section's title.
const Heading = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-caption-1-semibold text-text-secondary">{children}</h2>
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
  back,
  canEdit,
  hrefOf,
}: {
  record: BrainRecord;
  aliases: Set<string>;
  edges: Edge[];
  others: Map<string, Stub>;
  people: Map<string, string>;
  me: string;
  action: string;
  back: string;
  canEdit: boolean;
  hrefOf: (id: string) => string;
}) {
  // Whose a linked record is, when it is not the reader's own.
  const whose = (r?: Stub) =>
    !r || r.ownerId === me
      ? null
      : `${people.get(r.ownerId) ?? "someone no longer here"}'s`;
  return (
    <section className="flex flex-col gap-2">
      {(edges.length > 0 || canEdit) && <Heading>Links</Heading>}
      <ul className="flex flex-wrap items-center gap-2">
        {edges.map((e) => {
          const otherId = aliases.has(e.fromId) ? e.toId : e.fromId;
          const other = others.get(otherId);
          const title = aliases.has(otherId)
            ? "this record"
            : other?.title || "(untitled)";
          return (
            <li
              key={e.id}
              className="group flex h-8 items-center gap-1.5 rounded-full bg-background-secondary-default pr-1.5 pl-3"
            >
              <Link
                href={hrefOf(otherId)}
                className="max-w-64 truncate text-body-medium text-text-primary hover:underline"
              >
                {title}
              </Link>
              {whose(other) && (
                <span className="text-caption-2-regular text-text-secondary">
                  {whose(other)}
                </span>
              )}
              {canEdit ? (
                <Unlink
                  action={action}
                  back={back}
                  edge={e.id}
                  title={title}
                  verb={verbText(e.verb)}
                />
              ) : (
                <span className="w-1" />
              )}
            </li>
          );
        })}
        {canEdit && (
          <li>
            <LinkForm id={record.id} type={record.type} back={back} />
          </li>
        )}
      </ul>
    </section>
  );
}
