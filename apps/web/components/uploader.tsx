"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Progress = { name: string; done: number; parts: number; error?: string };

// What the server said, or what it answered.
const said = async (res: Response, doing: string) =>
  (await res.text().catch(() => "")) || `${doing} answered ${res.status}`;

// Sends files to the store in parts, each part straight to where the
// server says, so a file never passes through the server and can be as
// large as the filesystem allows.
export function Uploader({ path }: { path: string }) {
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList) {
    setBusy(true);
    const list = Array.from(files);
    setProgress(list.map((f) => ({ name: f.name, done: 0, parts: 1 })));
    await Promise.all(
      list.map(async (file, i) => {
        const note = (patch: Partial<Progress>) =>
          setProgress((all) =>
            all.map((x, j) => (j === i ? { ...x, ...patch } : x)),
          );
        try {
          const begun = await fetch("/files/begin", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name: file.name,
              size: file.size,
              type: file.type,
              path,
            }),
          });
          if (!begun.ok) throw new Error(await begun.text());
          const { id, partSize, parts } = await begun.json();
          note({ parts });
          const etags = [];
          for (let n = 1; n <= parts; n++) {
            const where = await fetch("/files/part", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id, partNumber: n }),
            });
            if (!where.ok) throw new Error(await said(where, `part ${n}`));
            const { url } = await where.json();
            const chunk = file.slice((n - 1) * partSize, n * partSize);
            const put = await fetch(url, { method: "PUT", body: chunk });
            if (!put.ok)
              throw new Error(`part ${n} was refused (${put.status})`);
            etags.push({
              partNumber: n,
              etag: put.headers.get("etag") ?? "",
            });
            note({ done: n });
          }
          const closed = await fetch("/files/complete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id, parts: etags }),
          });
          if (!closed.ok) throw new Error(await said(closed, "finishing"));
        } catch (err) {
          note({ error: (err as Error).message });
        }
      }),
    );
    setBusy(false);
    // The list refreshes when everything landed; a failure stays on screen.
    setProgress((all) => {
      if (all.every((x) => !x.error)) window.location.reload();
      return all;
    });
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem(
          "files",
        ) as HTMLInputElement;
        if (input.files?.length) void upload(input.files);
      }}
    >
      <div className="flex gap-2">
        <Input type="file" name="files" multiple disabled={busy} />
        <Button type="submit" disabled={busy}>
          Upload
        </Button>
      </div>
      {progress.length > 0 && (
        <ul className="text-muted-foreground text-sm">
          {progress.map((x) => (
            <li key={x.name}>
              {x.name}:{" "}
              {x.error
                ? `failed (${x.error})`
                : x.done === x.parts
                  ? "done"
                  : `${x.done} of ${x.parts} parts`}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
