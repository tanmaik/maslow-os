import { catalog, grantsOf, type Kind } from "@placeholder/brain";
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

import { LocalTime } from "@/components/local-time";

import { authorText, sharedGroups } from "../format";
import { KindIcon, KindMark } from "../kind-icon";
import { peopleOf } from "../people";
import { Sharing } from "../sharing";
import { TypeBadge } from "../type-badge";

const TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
  "list",
] as const;

// This person's vocabulary: every kind they defined with the fields it
// declares, and every verb, each with who defined it and who it is shared
// with; then the kinds colleagues have shared into this brain, grouped by
// who owns them and how they were opened. A person adds to their own here.
export default async function Page() {
  const p = await principal();
  if (!p) redirect("/");
  const { kinds, verbs, people, grants } = await asPerson(p, async (db) => {
    const vocabulary = await catalog(db);
    const grants = new Map(
      await Promise.all(
        vocabulary.kinds
          .filter((k) => !k.via)
          .map(
            async (k) => [k.id, await grantsOf(db, { kind: k.id })] as const,
          ),
      ),
    );
    return { ...vocabulary, people: await peopleOf(db), grants };
  });
  const groups = await groupsOf(p);
  const mine = kinds.filter((k) => !k.via);
  const shared = sharedGroups(kinds, people);
  const members = [...people].map(([id, name]) => ({ id, name }));
  const who = (author: string) => authorText(author, people);

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Vocabulary</h1>
        <p className="text-muted-foreground text-sm">
          The kinds of thing this brain holds and the ways they relate. They are
          yours: a colleague sees a kind, and every record of it, once you share
          it.
        </p>
      </div>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Kinds</h2>
          <div className="flex gap-2">
            <Define what="kind" />
            {mine.length > 0 && <AddField kinds={mine.map((k) => k.name)} />}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kind</TableHead>
              <TableHead className="hidden sm:table-cell">
                Description
              </TableHead>
              <TableHead>Fields</TableHead>
              <TableHead className="hidden lg:table-cell">Defined by</TableHead>
              <TableHead className="hidden lg:table-cell">When</TableHead>
              <TableHead>Sharing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mine.map((k) => (
              <TableRow key={k.id}>
                <TableCell className="max-w-48 align-top font-medium whitespace-normal">
                  <KindMark kind={k.name} />
                  <p className="text-muted-foreground mt-1 font-normal sm:hidden">
                    {k.description}
                  </p>
                </TableCell>
                <TableCell className="hidden max-w-md align-top whitespace-normal sm:table-cell">
                  {k.description}
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <Fields kind={k} />
                </TableCell>
                <TableCell className="text-muted-foreground hidden align-top lg:table-cell">
                  {who(k.author)}
                </TableCell>
                <TableCell className="text-muted-foreground hidden align-top whitespace-nowrap lg:table-cell">
                  <LocalTime at={k.createdAt} />
                </TableCell>
                <TableCell className="min-w-48 align-top whitespace-normal">
                  <Sharing
                    on={{ kind: k.id }}
                    owner
                    ownerName="you"
                    grants={grants.get(k.id) ?? []}
                    groups={groups}
                    members={members}
                  />
                </TableCell>
              </TableRow>
            ))}
            {mine.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  No kinds yet. Whoever writes the first record of a kind
                  defines it.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      {shared.map((g) => (
        <section key={`${g.ownerId}:${g.how}`} className="space-y-3">
          <h2 className="font-medium">
            {g.owner}
            {"'s kinds, "}
            {g.how}
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kind</TableHead>
                <TableHead className="hidden sm:table-cell">
                  Description
                </TableHead>
                <TableHead>Fields</TableHead>
                <TableHead className="hidden lg:table-cell">
                  Defined by
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {g.kinds.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="max-w-48 align-top font-medium whitespace-normal">
                    <KindMark kind={k.name} owner={k.ownerId} />
                    <p className="text-muted-foreground mt-1 font-normal sm:hidden">
                      {k.description}
                    </p>
                  </TableCell>
                  <TableCell className="hidden max-w-md align-top whitespace-normal sm:table-cell">
                    {k.description}
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <Fields kind={k} />
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden align-top lg:table-cell">
                    {who(k.author)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ))}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Verbs</h2>
          <Define what="verb" />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Verb</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="hidden lg:table-cell">Defined by</TableHead>
              <TableHead className="hidden lg:table-cell">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {verbs.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-medium">{v.name}</TableCell>
                <TableCell className="max-w-md whitespace-normal">
                  {v.description}
                </TableCell>
                <TableCell className="text-muted-foreground hidden lg:table-cell">
                  {who(v.author)}
                </TableCell>
                <TableCell className="text-muted-foreground hidden whitespace-nowrap lg:table-cell">
                  <LocalTime at={v.createdAt} />
                </TableCell>
              </TableRow>
            ))}
            {verbs.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No verbs yet. A link needs one.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>
    </>
  );
}

// The fields a kind declares, each with its type and what it means.
function Fields({ kind }: { kind: Kind }) {
  if (kind.properties.length === 0) {
    return <span className="text-muted-foreground">any</span>;
  }
  return (
    <dl className="space-y-2">
      {kind.properties.map((f) => (
        <div key={f.id} className="space-y-1">
          <dt className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{f.name}</span>
            <TypeBadge type={f.type} />
            {f.required && <Badge variant="secondary">required</Badge>}
            {f.options?.map((o) => (
              <Badge key={o} variant="outline">
                {o}
              </Badge>
            ))}
          </dt>
          <dd className="text-muted-foreground">{f.description}</dd>
        </div>
      ))}
    </dl>
  );
}

// A name and a sentence: all a kind or a verb is.
function Define({ what }: { what: "kind" | "verb" }) {
  return (
    <FormDialog
      trigger={`Define a ${what}`}
      title={`Define a ${what}`}
      description={
        what === "kind"
          ? "A kind of record this brain can hold, like person or commitment."
          : "A way two records relate, like owes or attended. Read from the first record to the second."
      }
    >
      <form
        action="/brain/vocabulary/define"
        method="post"
        className="grid gap-3"
      >
        <input type="hidden" name="what" value={what} />
        <div className="space-y-1">
          <Label htmlFor={`${what}-name`}>Name</Label>
          <Input
            id={`${what}-name`}
            name="name"
            required
            autoFocus
            placeholder={what === "kind" ? "commitment" : "owes"}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${what}-description`}>Description</Label>
          <Input
            id={`${what}-description`}
            name="description"
            placeholder="One sentence saying what it is."
            required
          />
        </div>
        <div>
          <Button type="submit">Define</Button>
        </div>
      </form>
    </FormDialog>
  );
}

// A field on a kind's form: its name, type, and what it means.
function AddField({ kinds }: { kinds: string[] }) {
  return (
    <FormDialog
      trigger="Add a field"
      title="Add a field"
      description="A field every record of a kind can carry, checked when it is written."
    >
      <form
        action="/brain/vocabulary/define"
        method="post"
        className="grid gap-3"
      >
        <input type="hidden" name="what" value="field" />
        <div className="space-y-1">
          <Label htmlFor="field-kind">Kind</Label>
          <Select name="kind" defaultValue={kinds[0]!}>
            <SelectTrigger id="field-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kinds.map((k) => (
                <SelectItem key={k} value={k}>
                  <KindIcon kind={k} />
                  {k}
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
          <Label htmlFor="field-type">Type</Label>
          <Select name="type" defaultValue="text">
            <SelectTrigger id="field-type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  <TypeBadge type={t} />
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
        <div className="space-y-1">
          <Label htmlFor="field-description">Description</Label>
          <Input id="field-description" name="description" required />
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
