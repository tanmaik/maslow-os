import { typeSharesOf, type BrainType } from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { groupsIn } from "@placeholder/db/groups";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { principal } from "@/lib/session";

import { vocabulary } from "../catalog";
import { HOLDS, sharedGroups } from "../format";
import { Sharing } from "../sharing";
import { TypeMark } from "../type-icon";

// The types of thing this brain holds, each with what it records and who may
// see it; then the types colleagues have shared in. The agent shapes them; a
// person decides who sees them.
export default async function Page() {
  const p = await principal();
  if (!p) redirect("/");
  const { types, people } = await vocabulary(p);
  const mine = types.filter((t) => t.own);
  const { shares, groups } = await asPerson(p, async (db) => ({
    shares: await typeSharesOf(db),
    groups: await groupsIn(db),
  }));
  const members = [...people].map(([id, name]) => ({ id, name }));

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Types</h1>
        <p className="text-muted-foreground text-sm">
          The kinds of thing this brain holds. Yours until you share one; a
          colleague who has a type shares every record of it with you.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {mine.map((t) => (
          <TypeCard key={t.id} type={t}>
            <Sharing
              on={{ type: t.id }}
              owner
              ownerName="you"
              shares={shares.get(t.id) ?? []}
              groups={groups}
              members={members}
              compact
            />
          </TypeCard>
        ))}
      </div>
      {sharedGroups(types, people).map((g) => (
        <section key={g.ownerId} className="space-y-3">
          <h2 className="text-muted-foreground text-sm">
            {g.owner}&apos;s, shared with you
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {g.types.map((t) => (
              <TypeCard key={t.id} type={t} owner={t.ownerId} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// The fields every record has before its type declares any.
const BUILT_IN: [string, string, boolean][] = [
  ["title", "text", true],
  ["body", "text", false],
  ["when", HOLDS.datetime, false],
];

// One line of a type's form: the field's name, starred when a record must
// fill it, and in a word what it holds; a choice names its options on hover.
function Field({
  name,
  holds,
  required,
  options,
}: {
  name: string;
  holds: string;
  required: boolean;
  options?: string[] | null;
}) {
  return (
    <li className="flex justify-between gap-3">
      <span>
        {name}
        {required && <span className="text-muted-foreground">*</span>}
      </span>
      <span
        className="text-muted-foreground text-right"
        title={options?.join(", ")}
      >
        {holds}
      </span>
    </li>
  );
}

// One type: its name, its form line by line, and, in a corner, who may see
// it.
function TypeCard({
  type: t,
  owner,
  children,
}: {
  type: BrainType;
  owner?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-base">
          <TypeMark type={t.name} owner={owner} />
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 text-sm">
        <ul className="space-y-0.5">
          {BUILT_IN.map(([name, holds, required]) => (
            <Field key={name} name={name} holds={holds} required={required} />
          ))}
          {t.properties.map((f) => (
            <Field
              key={f.id}
              name={f.name}
              holds={HOLDS[f.datatype]}
              required={f.required}
              options={f.options}
            />
          ))}
        </ul>
      </CardContent>
      {children && <CardFooter className="mt-auto px-4">{children}</CardFooter>}
    </Card>
  );
}
