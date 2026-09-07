import {
  catalog,
  sharesOf,
  type BrainType,
  type Share,
} from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { groupsOf } from "@placeholder/db/groups";
import { redirect } from "next/navigation";

import { FormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { principal } from "@/lib/session";

import { DatatypeBadge } from "../datatype-badge";
import { sharedGroups, verbText } from "../format";
import { peopleOf } from "../people";
import { Sharing } from "../sharing";
import { TypeIcon, TypeMark } from "../type-icon";

const DATATYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
  "list",
] as const;

// This person's vocabulary: every type they defined with the fields it
// declares and who it is shared with; the types colleagues have shared into
// this brain, grouped by who owns them; and the verbs their links carry. A person adds to their own here.
export default async function Page() {
  const p = await principal();
  if (!p) redirect("/");
  const { types, verbs, people, shares } = await asPerson(p, async (db) => {
    const vocabulary = await catalog(db);
    const shares = new Map<string, Share[]>();
    for (const t of vocabulary.types) {
      if (t.own) shares.set(t.id, await sharesOf(db, { type: t.id }));
    }
    return { ...vocabulary, people: await peopleOf(db), shares };
  });
  const groups = await groupsOf(p);
  const mine = types.filter((t) => t.own);
  const shared = sharedGroups(types, people);
  const members = [...people].map(([id, name]) => ({ id, name }));

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Vocabulary</h1>
        <p className="text-muted-foreground text-sm">
          The types of thing this brain holds. They are yours: a colleague sees
          a type, and every record of it, once you share it.
        </p>
      </div>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Types</h2>
          <div className="flex gap-2">
            <DefineType />
            {mine.length > 0 && <AddField types={mine.map((t) => t.name)} />}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Fields</TableHead>
              <TableHead>Sharing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mine.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="max-w-48 align-top font-medium whitespace-normal">
                  <TypeMark type={t.name} />
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <Fields type={t} />
                </TableCell>
                <TableCell className="min-w-48 align-top whitespace-normal">
                  <Sharing
                    on={{ type: t.id }}
                    owner
                    ownerName="you"
                    shares={shares.get(t.id) ?? []}
                    groups={groups}
                    members={members}
                  />
                </TableCell>
              </TableRow>
            ))}
            {mine.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No types yet. Whoever writes the first record of a type
                  defines it.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      {shared.map((g) => (
        <section key={g.ownerId} className="space-y-3">
          <h2 className="font-medium">
            {g.owner}
            {"'s types, shared with you"}
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Fields</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.types.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="max-w-48 align-top font-medium whitespace-normal">
                    <TypeMark type={t.name} owner={t.ownerId} />
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <Fields type={t} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}

      <section className="space-y-3">
        <h2 className="font-medium">Verbs</h2>
        <p className="text-muted-foreground text-sm">
          The words links carry. A verb is whatever a link says; there is
          nothing to define.
        </p>
        {verbs.length > 0 ? (
          <p className="flex flex-wrap gap-1.5">
            {verbs.map((v) => (
              <Badge key={v} variant="outline">
                {verbText(v)}
              </Badge>
            ))}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">No links yet.</p>
        )}
      </section>
    </>
  );
}

// The fields a type declares, each with its datatype.
function Fields({ type }: { type: BrainType }) {
  if (type.properties.length === 0) {
    return <span className="text-muted-foreground">any</span>;
  }
  return (
    <dl className="space-y-2">
      {type.properties.map((f) => (
        <dt key={f.id} className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{f.name}</span>
          <DatatypeBadge datatype={f.datatype} />
          {f.required && <Badge variant="secondary">required</Badge>}
          {f.options?.map((o) => (
            <Badge key={o} variant="outline">
              {o}
            </Badge>
          ))}
        </dt>
      ))}
    </dl>
  );
}

// A name: all a type is.
function DefineType() {
  return (
    <FormDialog
      trigger="Define a type"
      title="Define a type"
      description="A type of record this brain can hold, like person or commitment."
    >
      <form
        action="/brain/vocabulary/define"
        method="post"
        className="grid gap-3"
      >
        <input type="hidden" name="what" value="type" />
        <div className="space-y-1">
          <Label htmlFor="type-name">Name</Label>
          <Input
            id="type-name"
            name="name"
            required
            autoFocus
            placeholder="commitment"
          />
        </div>
        <div>
          <Button type="submit">Define</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// A field on a type's form: its name and what it holds.
function AddField({ types }: { types: string[] }) {
  return (
    <FormDialog
      trigger="Add a field"
      title="Add a field"
      description="A field every record of a type can carry, checked when it is written."
    >
      <form
        action="/brain/vocabulary/define"
        method="post"
        className="grid gap-3"
      >
        <input type="hidden" name="what" value="field" />
        <div className="space-y-1">
          <Label htmlFor="field-type">Type</Label>
          <Select name="type" defaultValue={types[0]!}>
            <SelectTrigger id="field-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t} value={t}>
                  <TypeIcon type={t} />
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="field-name">Name</Label>
          <Input
            id="field-name"
            name="name"
            pattern="[a-z][a-z0-9_]*"
            placeholder="due_date"
            required
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="field-datatype">Holds</Label>
          <Select name="datatype" defaultValue="text">
            <SelectTrigger id="field-datatype" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATATYPES.map((d) => (
                <SelectItem key={d} value={d}>
                  <DatatypeBadge datatype={d} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="field-options">Options, for an enum</Label>
          <Input
            id="field-options"
            name="options"
            placeholder="open, done, dropped"
          />
        </div>
        <Label className="gap-1.5 font-normal">
          <Checkbox name="required" value="1" />
          Required
        </Label>
        <div>
          <Button type="submit">Add</Button>
        </div>
      </form>
    </FormDialog>
  );
}
