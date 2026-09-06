"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Progress = {
  name: string;
  done: number;
  parts: number;
  landing?: boolean;
  // Still landing when the looking stopped.
  late?: boolean;
  error?: string;
};

// What the server said, or what it answered.
const said = async (res: Response, doing: string) =>
  (await res.text().catch(() => "")) || `${doing} answered ${res.status}`;

// Sends files to the store in parts, each part straight to where the
// server says, so a file never passes through the server and can be as
// large as the filesystem allows; then waits while the machine lands
// them on the disk.
export function Uploader({ path }: { path: string }) {
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);

  async function upload(files: FileList) {
    setBusy(true);
    const list = Array.from(files);
    setProgress(list.map((f) => ({ name: f.name, done: 0, parts: 1 })));
    // Each upload's id and its row, since two files can share a name.
    const landing = new Map<string, number>();
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
          landing.set(id, i);
          note({ landing: true });
        } catch (err) {
          note({ error: (err as Error).message });
        }
      }),
    );
    // The machine says when each has landed, or why it could not; a look
    // every second or two for as long as a big file takes. One no longer
    // listed has landed; one staged again is a failure that stays on
    // screen, and the sweep tries it again within the hour.
    const patch = (row: number, p: Partial<Progress>) =>
      setProgress((all) => all.map((x, j) => (j === row ? { ...x, ...p } : x)));
    for (let i = 0; i < 1800 && landing.size > 0; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch("/files/landing").catch(() => null);
      if (!res?.ok) continue;
      const { files: still } = (await res.json()) as {
        files: { id: string; state: string; said: string | null }[];
      };
      for (const [id, row] of landing) {
        const f = still.find((x) => x.id === id);
        if (f?.state === "landing") continue;
        landing.delete(id);
        if (f)
          patch(row, {
            error:
              f.state === "lost"
                ? `lost: ${f.said ?? "the store no longer has it"}; remove it from your computer`
                : `could not land on your disk: ${f.said ?? "no reason given"}; it is tried again within the hour`,
          });
      }
    }
    // One still landing when the looking stops stays on screen as such.
    for (const row of landing.values()) patch(row, { late: true });
    setBusy(false);
    // The list refreshes when everything landed; a failure, or a landing
    // not yet heard of, stays on screen.
    setProgress((all) => {
      if (all.every((x) => !x.error && !x.late)) window.location.reload();
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
                : x.late
                  ? "still landing on your disk; look again in a while"
                  : x.landing
                    ? "landing on your disk"
                    : x.done === x.parts
                      ? "sent"
                      : `${x.done} of ${x.parts} parts`}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
