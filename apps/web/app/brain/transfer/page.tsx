import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { principal } from "@/lib/session";

// What the last import left to say, by the query it redirected with.
type Notice = {
  error?: "file" | "refused";
  records?: string;
  edges?: string;
  kinds?: string;
  properties?: string;
  verbs?: string;
};

const ERRORS = {
  file: "That is not a brain file. Export one from a brain and try again.",
  refused:
    "The file has a record that does not fit its kind's form here, so nothing was imported.",
};

// The file door: this brain as a file, and a file into this brain.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Notice>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const n = await searchParams;
  const said = n.error
    ? ERRORS[n.error]
    : n.records !== undefined
      ? `Imported: ${n.records} records, ${n.edges} links, ${n.kinds} kinds, ${n.properties} fields, ${n.verbs} verbs added or changed.`
      : null;

  return (
    <div className="max-w-2xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Export & import</h1>
        <p className="text-muted-foreground text-sm">
          A brain travels as one file. Yours out, another in.
        </p>
      </div>
      <section className="space-y-2">
        <h2 className="font-medium">Export</h2>
        <p className="text-muted-foreground text-sm">
          Everything in this brain, as a file that imports into any brain:
          records, links, and the vocabulary they use.
        </p>
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href="/brain/export" />}
        >
          Download brain.json
        </Button>
      </section>
      <section className="space-y-3">
        <h2 className="font-medium">Import</h2>
        <p className="text-muted-foreground text-sm">
          Adds a brain file&apos;s records, links and vocabulary to this brain.
          What is already here is left as it is, and nothing is imported unless
          all of it fits.
        </p>
        <form
          action="/brain/import"
          method="post"
          encType="multipart/form-data"
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label htmlFor="file">Brain file</Label>
            <Input
              id="file"
              name="file"
              type="file"
              accept=".json,application/json"
              required
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" type="submit">
              Import
            </Button>
            {said && (
              <p
                className={`text-sm ${n.error ? "text-destructive" : "text-muted-foreground"}`}
              >
                {said}
              </p>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
