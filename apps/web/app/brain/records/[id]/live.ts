"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";

// A record's live document from the page's side: the copy this browser
// holds, the socket keeping it level with the relay's, and who else is in
// it. A socket that closes ends the document; whoever wants back in opens
// anew, from the relay's copy, since a copy from before would be merged in
// twice. Off is a relay that cannot be reached, or one that would not let
// this person in; the page then saves as it does alone.
export type Live = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
};
export type Presence = { id: string; name: string; color: string };

// A colour for a name, the same every time, in the one spelling the caret
// extension takes.
export function colorOf(name: string): string {
  const colors = [
    "#e5484d",
    "#e5763b",
    "#8fb339",
    "#30a46c",
    "#2f9ec9",
    "#6e56cf",
    "#c7449b",
    "#d6409f",
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colors[h % colors.length]!;
}

export function useLive(
  id: string,
  on: boolean,
  // What the person may do, which the ticket says; a change means a new
  // way in.
  canEdit: boolean,
  // Who is reading, so their own other tabs are not "others".
  meId: string,
): {
  live: Live | null;
  status: "off" | "joining" | "live";
  others: Presence[];
} {
  const [live, setLive] = useState<Live | null>(null);
  const [status, setStatus] = useState<"off" | "joining" | "live">(
    on ? "joining" : "off",
  );
  const [others, setOthers] = useState<Presence[]>([]);

  useEffect(() => {
    if (!on) return;
    let gone = false;
    let current: Live | null = null;
    let again: ReturnType<typeof setTimeout> | null = null;
    // Only the first way in is "joining", when the text waits; a try after
    // an outage leaves the page saving alone until it is in.
    let first = true;
    const leave = () => {
      if (!current) return;
      const { doc, provider } = current;
      current = null;
      provider.destroy();
      doc.destroy();
      setLive(null);
      setOthers([]);
    };
    // Back in after a while: soon after a socket that dropped, later after
    // a door that would not open.
    const later = (ms: number) => {
      if (gone) return;
      setStatus("off");
      again = setTimeout(() => void join(), ms);
    };
    const join = async () => {
      if (gone) return;
      if (first) setStatus("joining");
      first = false;
      let way: { url: string; name: string; ticket: string };
      try {
        const res = await fetch(`/brain/records/${id}/live`, {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return later(res.status === 404 ? 60_000 : 10_000);
        way = await res.json();
      } catch {
        return later(10_000);
      }
      if (gone) return;
      const doc = new Y.Doc();
      // A way in that never gets level is given up, and the text is free.
      let deadline: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        deadline = null;
        if (current?.provider !== provider) return;
        leave();
        later(10_000);
      }, 8000);
      const provider = new HocuspocusProvider({
        url: way.url,
        name: way.name,
        document: doc,
        token: way.ticket,
        // The document is offered to the page only once it is level with
        // the relay's, so a relay that is not there offers nothing and the
        // text stays as it was.
        onSynced: () => {
          if (current?.provider !== provider) return;
          if (deadline) clearTimeout(deadline);
          deadline = null;
          setLive(current);
          setStatus("live");
        },
        onClose: () => {
          if (current?.provider !== provider) return;
          if (deadline) clearTimeout(deadline);
          leave();
          later(2000);
        },
        onAuthenticationFailed: () => {
          if (current?.provider !== provider) return;
          if (deadline) clearTimeout(deadline);
          leave();
          later(30_000);
        },
      });
      provider.awareness?.on("change", () => {
        // Every tab is a client of its own; the row is of people, each
        // once, and never the reader themself.
        const seen = new Map<string, Presence>();
        for (const state of provider.awareness?.getStates().values() ?? []) {
          // What another browser says of its person, taken only in the
          // shape expected.
          const user = (state as { user?: unknown }).user;
          if (!user || typeof user !== "object") continue;
          const { id, name, color } = user as Record<string, unknown>;
          if (typeof id !== "string" || id === meId) continue;
          if (typeof name !== "string" || typeof color !== "string") continue;
          if (!/^#[0-9a-fA-F]{6}$/.test(color)) continue;
          if (!seen.has(id))
            seen.set(id, { id, name: name.slice(0, 80), color });
        }
        setOthers([...seen.values()]);
      });
      current = { doc, provider };
    };
    void join();
    return () => {
      gone = true;
      if (again) clearTimeout(again);
      leave();
    };
  }, [id, on, canEdit, meId]);

  return { live, status, others };
}
