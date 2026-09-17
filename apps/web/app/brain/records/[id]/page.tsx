import {
  aliasesOf,
  edgesOf,
  get,
  graph,
  history,
  stubs,
  isId,
  sharesOf,
  type BrainRecord,
  type Edge,
  type Stub,
} from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { groupsIn } from "@maslow/db/groups";
import { RiArrowLeftSLine } from "@remixicon/react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { EagerLink } from "@/components/eager-link";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";

import { vocabulary } from "../../catalog";
import { recordHref, verbText } from "../../format";
import { Sharing } from "../../sharing";
import { TypeMark } from "../../type-icon";
import { Document } from "./document";
import { LinkForm } from "./link-form";
import { BrainGraph } from "./lazy";
import { Properties } from "./properties";
import { Unlink } from "./unlink";
import { Whole, type Act } from "./whole";

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
    }),
  ]);
  if (!found) notFound();
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
    <div className="page-sheet @container flex min-h-full flex-col rounded-3xl border border-border-button-default bg-background-primary-default p-4 sm:p-5">
      <div className="grid flex-1 gap-x-8 gap-y-4 @2xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] @2xl:grid-rows-[auto_1fr]">
        <div className="col-span-full flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-2 text-caption-1-medium text-text-secondary">
            <EagerLink
              href="/brain"
              className="-ml-1 flex shrink-0 items-center gap-0.5 rounded-full px-1 py-0.5 transition-colors duration-fast ease-plain hover:text-text-primary"
            >
              <RiArrowLeftSLine className="size-3.5" aria-hidden />
              Your brain
            </EagerLink>
            <span aria-hidden>·</span>
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
          <Sharing
            on={{ record: r.id }}
            owner={isOwner && !r.deletedAt}
            ownerName={ownerName}
            shares={shares}
            groups={groups}
            members={[...people].map(([id, name]) => ({ id, name }))}
            pill
          />
          {isOwner && <Whole action={action} act={act} />}
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          {r.mergedInto && (
            <p className="border-l-2 border-separator-border pl-3 text-body-regular text-text-secondary">
              Merged into{" "}
              <Link
                href={recordHref(winner?.id ?? r.mergedInto)}
                className="text-text-primary underline"
              >
                {winner?.title || r.mergedInto}
              </Link>
              .
            </p>
          )}
          {r.deletedAt && !r.mergedInto && (
            <p className="border-l-2 border-separator-border pl-3 text-body-regular text-text-secondary">
              Removed.
            </p>
          )}
          <Document
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
            canEdit={canEdit}
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
                <BrainGraph graph={near} focus={winner?.id ?? r.id} />
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
  canEdit,
}: {
  record: BrainRecord;
  aliases: Set<string>;
  edges: Edge[];
  others: Map<string, Stub>;
  people: Map<string, string>;
  me: string;
  action: string;
  canEdit: boolean;
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
            ? `this ${record.type}`
            : other?.title || "(untitled)";
          return (
            <li
              key={e.id}
              className="group flex h-8 items-center gap-1.5 rounded-full bg-background-secondary-default pr-1.5 pl-3"
            >
              <Link
                href={recordHref(otherId)}
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
            <LinkForm id={record.id} type={record.type} />
          </li>
        )}
      </ul>
    </section>
  );
}
