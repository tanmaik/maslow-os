import { catalog, read, type BrainRecord } from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { principal } from "@/lib/session";

// The signed-in person's brain: the org's vocabulary, a search over their
// records, a way to write a note, and the export.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; imported?: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { q = "", kind = "", imported } = await searchParams;
  const { me, vocabulary, page } = await asPerson(p, async (db) => ({
    me: (
      await db.query<{ name: string }>("select name from users where id = $1", [
        p.userId,
      ])
    ).rows[0]?.name,
    vocabulary: await catalog(db),
    page: await read(db, { query: q || undefined, kind: kind || undefined }),
  }));

  return (
    <main className="space-y-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{me}&apos;s brain</h1>
        <Button
          variant="ghost"
          size="sm"
          render={<a href="/" />}
          nativeButton={false}
        >
          Home
        </Button>
      </header>

      <section className="space-y-3">
        <form method="get" className="flex gap-2">
          <Input
            name="q"
            defaultValue={q}
            placeholder="search, e.g. rocket friday"
          />
          <NativeSelect name="kind" defaultValue={kind} className="w-40">
            <NativeSelectOption value="">any kind</NativeSelectOption>
            {vocabulary.kinds.map((k) => (
              <NativeSelectOption key={k.id} value={k.name}>
                {k.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button type="submit">Search</Button>
        </form>
        <p className="text-muted-foreground text-sm">
          {page.records.length} records{page.cursor ? ", more available" : ""}
          {imported ? ` · ${imported} added or changed by import` : ""}
        </p>
        <ul className="divide-y">
          {page.records.map((r) => (
            <RecordItem key={r.id} record={r} />
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Vocabulary</h2>
        <dl className="space-y-3">
          {vocabulary.kinds.map((k) => (
            <div key={k.id}>
              <dt>
                <span className="font-medium">{k.name}</span>{" "}
                <span className="text-muted-foreground text-sm">
                  kind · {k.author}
                </span>
              </dt>
              <dd className="text-muted-foreground text-sm">
                {k.description}
                {k.properties.length > 0 && (
                  <ul className="mt-1 list-disc pl-5">
                    {k.properties.map((f) => (
                      <li key={f.id}>
                        <code>{f.name}</code>: {f.type}
                        {f.options ? ` (${f.options.join(", ")})` : ""}
                        {f.required ? ", required" : ""} · {f.description}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          ))}
          {vocabulary.verbs.map((v) => (
            <div key={v.id}>
              <dt>
                <span className="font-medium">{v.name}</span>{" "}
                <span className="text-muted-foreground text-sm">
                  verb · {v.author}
                </span>
              </dt>
              <dd className="text-muted-foreground text-sm">{v.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Write a note</h2>
        <form action="/brain/note" method="post" className="space-y-2">
          <Input name="title" placeholder="title" required />
          <Textarea name="body" placeholder="body" rows={3} />
          <Button type="submit">Write</Button>
        </form>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Export and import</h2>
        <Button
          variant="outline"
          render={<a href="/brain/export" />}
          nativeButton={false}
        >
          Download this brain as a file
        </Button>
        <form action="/brain/import" method="post" className="space-y-2">
          <Textarea
            name="snapshot"
            placeholder="paste an exported file here"
            rows={4}
            required
          />
          <Button variant="outline" type="submit">
            Import into this brain
          </Button>
        </form>
      </section>
    </main>
  );
}

function RecordItem({ record: r }: { record: BrainRecord }) {
  return (
    <li className="space-y-1 py-3">
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{r.title || "(untitled)"}</span>
        <Badge variant="secondary">{r.kind}</Badge>
        <span className="text-muted-foreground text-xs">
          {r.layer}
          {r.confidence !== null ? ` · ${Math.round(r.confidence * 100)}%` : ""}
        </span>
      </div>
      {r.body && <p className="text-sm">{r.body}</p>}
      <p className="text-muted-foreground text-xs">
        from {r.source} {r.sourceRef}
        {r.occurredAt ? ` · ${r.occurredAt.toISOString().slice(0, 10)}` : ""}
        {" · by "}
        {r.author} · v{r.version}
      </p>
    </li>
  );
}
