"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Markdown } from "@/components/markdown";
import { Textarea } from "@/components/ui/textarea";

import { save } from "./save";

// A record as a document: a title and a body a person edits where they
// read them, kept as they leave each one. A body is markdown, shown as
// such until it is clicked into.
export function Document({
  id,
  title,
  body,
  canEdit,
}: {
  id: string;
  title: string;
  body: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [heading, setHeading] = useState(title);
  const [text, setText] = useState(body);
  const [writing, setWriting] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);

  // Saves of a field go one after another, so none lands out of order. A
  // change that did not save is said, and put back to the last that did,
  // unless the person has typed on since.
  const saves = useRef({ title: Promise.resolve(), body: Promise.resolve() });
  const kept = useRef({ title, body });
  const queued = useRef({ title, body });
  const keep = (field: "title" | "body", value: string) => {
    if (value === queued.current[field]) return;
    queued.current[field] = value;
    saves.current[field] = saves.current[field].then(async () => {
      const said = await save(id, { [field]: value });
      setTrouble(said);
      if (said) {
        const set = field === "title" ? setHeading : setText;
        set((now) => (now === value ? kept.current[field] : now));
        if (queued.current[field] === value)
          queued.current[field] = kept.current[field];
      } else {
        kept.current[field] = value;
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      {canEdit ? (
        <Textarea
          aria-label="Title"
          rows={1}
          value={heading}
          onChange={(e) => setHeading(e.target.value.replace(/\n/g, " "))}
          onBlur={() => {
            setHeading(heading.trim());
            keep("title", heading.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          placeholder="Untitled"
          className="min-h-0 field-sizing-content resize-none rounded-none border-0 bg-transparent px-0 py-0 font-serif text-[26px] leading-[30px] font-normal tracking-[-0.01em] shadow-none focus-visible:ring-0 md:text-[26px] dark:bg-transparent"
        />
      ) : (
        <h1 className="font-serif text-[26px] leading-[30px] font-normal tracking-[-0.01em]">
          {title || "(untitled)"}
        </h1>
      )}
      {canEdit && (writing || !text.trim()) ? (
        <Textarea
          aria-label="Body"
          value={text}
          autoFocus={writing}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setWriting(true)}
          onBlur={() => {
            setWriting(false);
            setText(text.trim());
            keep("body", text.trim());
          }}
          placeholder="Write here. Markdown works."
          className="min-h-24 field-sizing-content resize-none border-0 bg-transparent px-0 leading-relaxed shadow-none focus-visible:ring-0 md:text-sm dark:bg-transparent"
        />
      ) : (
        <div
          onClick={canEdit ? () => setWriting(true) : undefined}
          className={canEdit ? "cursor-text" : undefined}
        >
          <Markdown>{text}</Markdown>
        </div>
      )}
      {trouble && <p className="text-destructive text-sm">{trouble}</p>}
    </div>
  );
}
