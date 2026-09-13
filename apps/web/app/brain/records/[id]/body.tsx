"use client";

import { Markdown as MarkdownFormat } from "tiptap-markdown";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { DOMParser as DOMParse } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { useEffect, useRef, useState } from "react";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// What the slash menu offers, in the order it offers them: what it is
// called, and what it does to the block the caret is in.
const INSERTS: { name: string; run: (e: Editor) => void }[] = [
  {
    name: "Heading",
    run: (e) => e.chain().focus().setNode("heading", { level: 1 }).run(),
  },
  {
    name: "Subheading",
    run: (e) => e.chain().focus().setNode("heading", { level: 2 }).run(),
  },
  {
    name: "Bulleted list",
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    name: "Numbered list",
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  { name: "Quote", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { name: "Divider", run: (e) => e.chain().focus().setHorizontalRule().run() },
  { name: "Code", run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

// Markdown as the editor spells it: an emphasis in stars rather than
// underscores, a bullet in dashes, a divider in three dashes, a number
// with a dot, no indent, no blank line between blocks. The same document
// said the same way, so two spellings of it compare equal. An escape is
// not a spelling: brackets that come back escaped are a task list the
// editor turned into words, and that is a body it cannot hold.
const spelled = (md: string) =>
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

// The editor's own markdown: reading it, writing it, and parsing it.
const store = (e: Editor) =>
  (
    e.storage as unknown as {
      markdown: {
        getMarkdown(): string;
        serializer: { serialize(content: unknown): string };
        parser: { parse(md: string, opts?: { inline?: boolean }): string };
      };
    }
  ).markdown;
const markdownOf = (e: Editor) => store(e).getMarkdown();

// Whether the editor can hold a body whole: a table, an image, anything
// its schema has no node for comes back changed, and saving that back
// would throw the rest away.
function holds(e: Editor, body: string): boolean {
  return spelled(markdownOf(e)) === spelled(body);
}

// How tall the slash menu stands, which is what says whether it fits
// under the line it was opened on.
const MENU = 268;

// Whether markdown survives the editor: it is parsed as the editor parses
// it and written straight back out, and what comes back must say the same.
function survives(e: Editor, md: string): boolean {
  // Read in a document of its own, where a tag a paste carries neither
  // loads nor runs.
  const held = new window.DOMParser().parseFromString(
    store(e).parser.parse(md),
    "text/html",
  );
  const doc = DOMParse.fromSchema(e.schema).parse(held.body);
  return spelled(store(e).serializer.serialize(doc.content)) === spelled(md);
}

// A record's body, written the way it reads: what is typed takes its shape
// as it is typed, and a slash offers what a line can become. Markdown is
// what is stored, so what an agent writes and what a person writes are the
// same text.
export function Body({
  body,
  canEdit,
  onKeep,
}: {
  body: string;
  canEdit: boolean;
  onKeep: (text: string) => Promise<boolean>;
}) {
  // A body the editor cannot hold whole — a table, an image, anything its
  // schema has no node for — is written as text instead, since saving what
  // the editor could parse would quietly throw the rest away.
  const [whole, setWhole] = useState(true);
  // An empty body says what to do with it rather than sitting blank.
  const [blank, setBlank] = useState(!body.trim());
  const [text, setText] = useState(body);
  const [slash, setSlash] = useState<{ at: number; top: number } | null>(null);
  const [pick, setPick] = useState(0);
  const kept = useRef(body);
  const box = useRef<HTMLDivElement>(null);
  // The editor answers the keyboard before this page sees it, so the menu's
  // keys are read inside it, off what is on screen right now.
  const open = useRef(false);
  const chosen = useRef(0);
  const take = useRef<(i: number) => void>(() => {});
  const ed = useRef<Editor | null>(null);
  // Whether the person is in the text a body falls back to, which the
  // editor's own focus does not say, and whether they changed anything:
  // leaving a body untouched saves nothing over what arrived meanwhile.
  const typing = useRef(false);
  const edited = useRef(false);
  open.current = slash !== null;
  chosen.current = pick;

  const editor = useEditor(
    {
      editable: canEdit,
      immediatelyRender: false,
      extensions: [
        StarterKit.configure({ underline: false }),
        MarkdownFormat.configure({ transformPastedText: true }),
      ],
      content: body,
      onCreate: ({ editor: e }) => {
        ed.current = e;
        setBlank(e.isEmpty);
        if (!holds(e, body)) setWhole(false);
      },
      editorProps: {
        handlePaste: (view: EditorView, event?: ClipboardEvent) => {
          const pasted = event?.clipboardData?.getData("text/plain");
          const e = ed.current;
          if (!e || !pasted || survives(e, pasted)) return false;
          // Markdown the editor cannot hold is not parsed at all: it goes
          // in as the text it is, so none of it is thrown away. That paste
          // carries no event, and so passes straight through here.
          view.pasteText(pasted);
          return true;
        },
        handleKeyDown: (_view, event) => {
          if (!open.current) return false;
          if (event.key === "Escape") setSlash(null);
          else if (event.key === "ArrowDown")
            setPick((p) => (p + 1) % INSERTS.length);
          else if (event.key === "ArrowUp")
            setPick((p) => (p - 1 + INSERTS.length) % INSERTS.length);
          else if (event.key === "Enter") take.current(chosen.current);
          else return false;
          return true;
        },
        attributes: {
          class:
            "min-h-7 focus:outline-none [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-medium [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:my-4 [&_hr]:border-t [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:rounded-[10px] [&_pre]:bg-muted [&_pre]:p-3 [&>*+*]:mt-2",
          "aria-label": "Body",
        },
      },
      onUpdate: ({ editor: e }) => {
        edited.current = true;
        setBlank(e.isEmpty);
        // A slash on an empty line is a menu; anything else closes it.
        const { $from } = e.state.selection;
        const line = $from.parent.textContent;
        if (line === "/") {
          const at = e.view.coordsAtPos($from.pos);
          const top = box.current?.getBoundingClientRect().top ?? 0;
          // Under the line, or over it when the window has no room under.
          const under = window.innerHeight - at.bottom > MENU;
          setSlash({
            at: $from.pos,
            top: under
              ? at.bottom - top + 4
              : Math.max(4, at.top - top - MENU - 4),
          });
          setPick(0);
        } else setSlash(null);
      },
      onSelectionUpdate: ({ editor: e }) => {
        // The menu is the line's: a caret that leaves takes it with it.
        if (e.state.selection.$from.parent.textContent !== "/") setSlash(null);
      },
      onBlur: ({ editor: e }) => {
        setSlash(null);
        // One line ending, the one an agent writes, so a body a person
        // touched and a body the agent wrote are the same text. The last
        // that saved is only forgotten once the next one has.
        if (!edited.current) return;
        edited.current = false;
        const said = markdownOf(e).replace(/\r\n/g, "\n").trim();
        void onKeep(said).then((saved) => {
          if (saved) kept.current = said;
          // A save that did not land leaves the body changed, so leaving
          // it again tries once more.
          else edited.current = true;
        });
      },
    },
    [canEdit],
  );

  // A body rewritten elsewhere — by the agent, or in another window —
  // replaces what is shown, unless the person is in the middle of it.
  useEffect(() => {
    if (!editor || editor.isFocused || typing.current || body === kept.current)
      return;
    kept.current = body;
    setText(body);
    editor.commands.setContent(body, { emitUpdate: false });
    edited.current = false;
    setBlank(editor.isEmpty);
    // What arrived may be something the editor cannot hold, so it is asked
    // again of every body, not only the first.
    setWhole(holds(editor, body));
  }, [body, editor]);

  if (!canEdit) return <Markdown>{body}</Markdown>;
  if (!whole)
    return (
      <Textarea
        aria-label="Body"
        value={text}
        onChange={(e) => {
          edited.current = true;
          setText(e.target.value);
        }}
        onFocus={() => {
          typing.current = true;
        }}
        onBlur={() => {
          typing.current = false;
          if (!edited.current) return;
          edited.current = false;
          const said = text.trim();
          void onKeep(said).then((saved) => {
            if (saved) kept.current = said;
            else edited.current = true;
          });
        }}
        className="min-h-24 flex-1 field-sizing-content resize-none border-0 bg-transparent px-0 leading-relaxed shadow-none focus-visible:ring-0 md:text-sm dark:bg-transparent"
      />
    );

  const choose = (i: number) => {
    if (!editor || !slash) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: slash.at - 1, to: slash.at })
      .run();
    INSERTS[i]!.run(editor);
    setSlash(null);
  };
  take.current = choose;

  return (
    <div
      ref={box}
      className="relative min-h-24 flex-1 @lg:min-h-32"
      onMouseDown={(e) => {
        // The room under the last line belongs to the body: a click in it
        // carries on writing rather than doing nothing.
        if (e.target !== e.currentTarget || !editor) return;
        e.preventDefault();
        editor.commands.focus("end");
      }}
    >
      {blank && (
        <p className="text-muted-foreground pointer-events-none absolute inset-x-0 top-0 leading-relaxed">
          Write something, or press / for what a line can be
        </p>
      )}
      <EditorContent editor={editor} />
      {slash && (
        <div
          role="listbox"
          aria-label="Insert"
          style={{ top: slash.top }}
          className="bg-popover absolute left-0 z-30 flex w-60 flex-col gap-0.5 rounded-xl border p-1.5 shadow-float"
        >
          <span className="text-muted-foreground px-2 pt-1 pb-0.5 text-xs">
            Insert
          </span>
          {INSERTS.map((i, n) => (
            <Button
              key={i.name}
              variant={n === pick ? "secondary" : "ghost"}
              size="sm"
              role="option"
              aria-selected={n === pick}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(n);
              }}
              onMouseEnter={() => setPick(n)}
              className="h-8 justify-start rounded-lg px-2 font-normal"
            >
              {i.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
