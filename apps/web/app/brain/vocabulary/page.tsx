import { typeSharesOf, type BrainType } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { groupsIn } from "@maslow/db/groups";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Chip } from "@/components/base/badges/chip";
import { principal } from "@/lib/session";

import { vocabulary } from "../catalog";
import { HOLDS, sharedGroups } from "../format";
import { Sharing } from "../sharing";
import { TypeMark } from "../type-icon";

// The types of thing this brain holds, one line each: its name and how
// many records it has, the fields it declares beyond the title, body and
// when every record carries, and who may see it; then the types colleagues
// have shared in. The agent shapes them; a person decides who sees them.
export default async function Page() {
  const p = await principal();
  if (!p) redirect("/");
  const { types, held, people } = await vocabulary(p);
  const mine = types.filter((t) => t.own);
  const { shares, groups } = await asPerson(p, async (db) => ({
    shares: await typeSharesOf(db),
    groups: await groupsIn(db),
  }));
  const members = [...people].map(([id, name]) => ({ id, name }));
  const count = (t: BrainType) => held.get(`${t.ownerId}:${t.name}`) ?? 0;

  return (
    <div className="brain-inset flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="page-title text-title-1-medium text-text-primary">
          Types and fields
        </h1>
        <p className="text-body-regular text-text-secondary">
          The kinds of thing this brain holds. Every record has a title, a body
          and a when; a type adds the fields listed beside it. Yours until you
          share one.
        </p>
      </div>
      <Sheet>
        {mine.map((t) => (
          <Line key={t.id} type={t} count={count(t)}>
            <Sharing
              on={{ type: t.id }}
              owner
              ownerName="you"
              shares={shares.get(t.id) ?? []}
              groups={groups}
              members={members}
              pill
            />
          </Line>
        ))}
      </Sheet>
      {sharedGroups(types, people).map((g) => (
        <div key={g.ownerId} className="flex flex-col gap-2">
          <p className="px-1 text-caption-1-medium text-text-secondary">
            {g.owner}&apos;s, shared with you
          </p>
          <Sheet>
            {g.types.map((t) => (
              <Line key={t.id} type={t} count={count(t)} owner={t.ownerId} />
            ))}
          </Sheet>
        </div>
      ))}
    </div>
  );
}

// One sheet of lines, a hairline between each. A card on a page, not the
// page itself: a window keeps its chrome.
function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-separator-border rounded-3xl border border-border-button-default bg-background-primary-default">
      {children}
    </div>
  );
}

// One type on a line: its mark and how full it is, then its own fields,
// then who may see it.
function Line({
  type: t,
  count,
  owner,
  children,
}: {
  type: BrainType;
  count: number;
  owner?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <span className="flex w-44 shrink-0 items-baseline gap-2">
        <TypeMark
          type={t.name}
          owner={owner}
          className="text-body-medium text-text-primary"
        />
        <span className="text-caption-1-regular text-text-secondary tabular-nums">
          {count}
        </span>
      </span>
      <span className="flex min-w-48 flex-1 flex-wrap items-center gap-1.5">
        {t.properties.length === 0 ? (
          <span className="text-caption-1-regular text-text-secondary">
            No fields of its own
          </span>
        ) : (
          t.properties.map((f) => (
            <Chip
              key={f.name}
              variant="caption"
              color="soft"
              title={f.options?.length ? f.options.join(", ") : undefined}
            >
              {f.name}
              <span className="ml-1 text-text-secondary">
                {HOLDS[f.datatype]}
                {f.required && ", required"}
              </span>
            </Chip>
          ))
        )}
      </span>
      {children && <span className="ml-auto shrink-0">{children}</span>}
    </div>
  );
}
