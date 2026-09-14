import type { Editor } from "@tiptap/core";
import { DOMParser as DOMParse } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

// What a record's body is made of, for every editor that holds one: the
// page's and the relay's alike, so both read and write the same markdown.
// Undo is left out where Yjs keeps it.
export function extensions({ undoRedo = true } = {}) {
  return [
    StarterKit.configure({ underline: false, undoRedo: undoRedo && {} }),
    Markdown.configure({ transformPastedText: true }),
  ];
}

// Markdown as the editor spells it: an emphasis in stars rather than
// underscores, a bullet in dashes, a divider in three dashes, a number
// with a dot, no indent, no blank line between blocks. The same document
// said the same way, so two spellings of it compare equal. An escape is
// not a spelling: brackets that come back escaped are a task list the
// editor turned into words, and that is a body it cannot hold.
export const spelled = (md: string) =>
  md
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/^(.+)\n=+$/gm, "# $1")
    .replace(/^[*+](?= )/gm, "-")
    .replace(/^(\d+)\)(?= )/gm, "$1.")
    .replace(/^(?:\*{3,}|_{3,})$/gm, "---")
    .replace(/__(\S[^_\n]*)__/g, "**$1**")
    .replace(/_(\S[^_\n]*)_/g, "*$1*")
    .replace(/\n{2,}/g, "\n")
    .trim();

// The editor's own markdown: parsing it, and writing it.
const store = (e: Editor) =>
  (
    e.storage as unknown as {
      markdown: {
        serializer: { serialize(content: unknown): string };
        parser: { parse(md: string, opts?: { inline?: boolean }): string };
      };
    }
  ).markdown;

// Whether markdown survives the editor: it is parsed as the editor parses
// it and written straight back out, and what comes back must say the
// same. A table, an image, anything the editor has no node for comes back
// changed, and that is a body it cannot hold.
export function survives(e: Editor, md: string): boolean {
  // Read in a document of its own, where a tag a paste carries neither
  // loads nor runs.
  const held = new window.DOMParser().parseFromString(
    store(e).parser.parse(md),
    "text/html",
  );
  const doc = DOMParse.fromSchema(e.schema).parse(held.body);
  return spelled(store(e).serializer.serialize(doc.content)) === spelled(md);
}
