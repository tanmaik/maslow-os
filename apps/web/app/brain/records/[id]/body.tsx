"use client";

import { extensions, spelled, survives } from "@maslow/document/extensions";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { EditorView } from "@tiptap/pm/view";
import {
  RiCodeBlock,
  RiDoubleQuotesL,
  RiH1,
  RiH2,
  RiListOrdered,
  RiListUnordered,
  RiSeparator,
} from "@remixicon/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";

import { Markdown } from "@/components/markdown";
import {
  MENU_ITEM,
  MENU_ITEM_ACTIVE,
  MENU_ITEM_INTERACTIVE,
  MENU_POPOVER_SURFACE,
} from "@/components/base/dropdown/menu-styles";
import { Textarea } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";

import type * as Y from "yjs";

import { colorOf, type Live } from "./live";

type Mark = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

// What the slash menu offers, in the order it offers them: what it is
// called, its mark, and what it does to the block the caret is in.
const INSERTS: { name: string; mark: Mark; run: (e: Editor) => void }[] = [
  {
    name: "Heading",
    mark: RiH1,
    run: (e) => e.chain().focus().setNode("heading", { level: 1 }).run(),
  },
  {
    name: "Subheading",
    mark: RiH2,
    run: (e) => e.chain().focus().setNode("heading", { level: 2 }).run(),
  },
  {
    name: "Bulleted list",
    mark: RiListUnordered,
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    name: "Numbered list",
    mark: RiListOrdered,
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    name: "Quote",
    mark: RiDoubleQuotesL,
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    name: "Divider",
    mark: RiSeparator,
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    name: "Code",
    mark: RiCodeBlock,
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
  },
];

// The editor's own markdown.
const markdownOf = (e: Editor) =>
  (
    e.storage as unknown as { markdown: { getMarkdown(): string } }
  ).markdown.getMarkdown();

// Whether the editor can hold a body whole: a table, an image, anything
// its schema has no node for comes back changed, and saving that back
// would throw the rest away.
function holds(e: Editor, body: string): boolean {
  return spelled(markdownOf(e)) === spelled(body);
}

// A line that is asking the menu for something: a slash, and as much of a
// word as has been typed after it.
const ASKING = /^\/(\w*)$/;

// A body with one line ending, no blank lines before it and nothing after
// it, to compare letter for letter: a space at the start of a line is a
// change, in a code block most of all.
const exact = (md: string) =>
  md.replace(/\r\n?/g, "\n").replace(/^\n+/, "").trimEnd();

// Resolves once a shared document has changed and reads as wanted, or
// after the wait: the relay's own rewrite of it, from the saved draft, is
// what is waited for, so a document that already read the same by text
// but not by shape is not taken before that.
function says(doc: Y.Doc, want: string, ms: number): Promise<void> {
  const text = () =>
    doc.getXmlFragment("default").toDOM(document).textContent ?? "";
  return new Promise((done) => {
    const finish = () => {
      doc.off("update", look);
      clearTimeout(timer);
      done();
    };
    const look = () => {
      if (text() === want) finish();
    };
    const timer = setTimeout(finish, ms);
    doc.on("update", look);
  });
}

// A record's body, written the way it reads: what is typed takes its shape
// as it is typed, and a slash offers what a line can become. Markdown is
// what is stored, so what an agent writes and what a person writes are the
// same text. Live, the body is the relay's document: everyone's typing
// merges as it happens, their carets carry their names, the relay saves,
// and a reader watches it move; alone, the page saves as the person leaves
// the text.
export function Body({
  body,
  seen,
  put,
  canEdit,
  live,
  joining,
  me,
  onKeep,
}: {
  body: string;
  // The change the page's body rests on.
  seen: number;
  // The relay's document, when the page is in it, and whether the page is
  // on its way in: typing then would be thrown away with the copy it went
  // into, so the text waits.
  live: Live | null;
  joining: boolean;
  // The person, on their caret for everyone else: who, by membership,
  // and their name.
  me: { id: string; name: string };
  // A body the person chose, put in the text whether or not they are in
  // it, resting on the change it names; a new count is a new choice.
  put: { n: number; body: string; seen: number } | null;
  canEdit: boolean;
  // Saves the text, naming the change it rests on; answers with the
  // record's last change once it landed, "behind" when the record changed
  // since, or null.
  onKeep: (text: string, base: number) => Promise<number | "behind" | null>;
}) {
  // A body the editor cannot hold whole — a table, an image, anything its
  // schema has no node for — is written as text instead, since saving what
  // the editor could parse would quietly throw the rest away.
  const [whole, setWhole] = useState(true);
  // An empty body says what to do with it rather than sitting blank.
  const [blank, setBlank] = useState(!body.trim());
  const [text, setText] = useState(body);
  // Where the caret was when the menu opened, what has been typed after the
  // slash, and where on the line the menu hangs from.
  const [slash, setSlash] = useState<{
    at: number;
    word: string;
    top: number;
    bottom: number;
  } | null>(null);
  // Where the menu hangs and how tall it may stand, both worked out from
  // the room the window actually has.
  const [hangs, setHangs] = useState({ top: 0, max: 0 });
  const [pick, setPick] = useState(0);
  const kept = useRef(body);
  // The change the text on screen rests on: moved when the page's body is
  // taken, and when a save of this text lands.
  const base = useRef(seen);
  // The page's body and change as they are now, for a handler made earlier.
  const latest = useRef({ body, seen });
  latest.current = { body, seen };
  // The text the fallback box holds now, for the same reason.
  const textNow = useRef(body);
  textNow.current = text;
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // The relay's document the editor is bound to. It lags the page's by a
  // save: what was typed alone, before the page was in, is saved first,
  // so no draft goes with the editor it went into.
  const [joined, setJoined] = useState<Live | null>(live);
  const offered = useRef(live);
  offered.current = live;
  // Whether a draft is on its way to the brain ahead of the handoff, during
  // which the text waits too, and the saver as it is now, for an effect
  // that must not run again for it.
  const [handing, setHanding] = useState(false);
  // A handoff that failed waits a while before another try, with the text
  // free meanwhile; the count is bumped so the wait ends in a rerun.
  const paused = useRef(false);
  const [tries, setTries] = useState(0);
  const keep = useRef(onKeep);
  keep.current = onKeep;
  // Which choice of the person's was already put in the text, so a
  // document that comes and goes does not put it again over newer text.
  const putDone = useRef(0);
  // A save the person's leaving of the text set going, not yet landed:
  // the handoff waits for it.
  const saving = useRef<Promise<unknown> | null>(null);
  // What the live text said when its socket dropped, in case the relay
  // never got the last of it: the text alone starts from it, unsaved, and
  // resting on the change the page had when the socket opened, so a save
  // of it cannot write over what landed meanwhile without asking.
  const parting = useRef<string | null>(null);
  const joinedAt = useRef(seen);
  // Whether the text is the relay's document now, for a save's answer that
  // arrives after the text changed hands.
  const joinedNow = useRef(joined);
  joinedNow.current = joined;
  // The editor answers the keyboard before this page sees it, so the menu's
  // keys are read inside it, off what is on screen right now.
  const open = useRef(false);
  const chosen = useRef(0);
  const choices = useRef(INSERTS);
  const take = useRef<(i: number) => void>(() => {});
  const ed = useRef<Editor | null>(null);
  // Whether the person is in the text a body falls back to, which the
  // editor's own focus does not say, and whether they changed anything:
  // leaving a body untouched saves nothing over what arrived meanwhile.
  const typing = useRef(false);
  const edited = useRef(false);
  open.current = slash !== null;

  const editor = useEditor(
    {
      editable: canEdit,
      immediatelyRender: false,
      extensions: joined
        ? [
            ...extensions({ undoRedo: false }),
            Collaboration.configure({ document: joined.doc }),
            CollaborationCaret.configure({
              provider: joined.provider,
              user: { id: me.id, name: me.name, color: colorOf(me.name) },
            }),
          ]
        : extensions(),
      content: joined ? undefined : body,
      onCreate: ({ editor: e }) => {
        ed.current = e;
        // Text alone again after a socket dropped: what the live text last
        // said, if the page does not have it yet, is unsaved here.
        let holding = body;
        if (!joined && parting.current !== null) {
          const was = parting.current;
          parting.current = null;
          // What the live text last said is kept only over a page the
          // editor could hold: a body it cannot — a table the record was
          // rewritten to — is the newer thing, and is shown instead. A
          // page no newer than the socket was is not that: it has only
          // not caught up, and the draft stays.
          const stale = seen <= joinedAt.current;
          if (exact(was) !== exact(body) && (holds(e, body) || stale)) {
            e.commands.setContent(was, { emitUpdate: false });
            edited.current = true;
            holding = was;
            // Resting on the change the page had when the socket opened,
            // whatever the page has taken since.
            base.current = joinedAt.current;
          } else base.current = seen;
        }
        setBlank(e.isEmpty);
        // What the editor holds is measured against what it was given, and
        // the text box's state starts over with this editor.
        if (!joined) {
          const whole = holds(e, holding);
          setText(holding);
          setWhole(whole);
        }
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
          const many = choices.current.length;
          if (event.key === "Escape") setSlash(null);
          else if (event.key === "ArrowDown") setPick((p) => (p + 1) % many);
          else if (event.key === "ArrowUp")
            setPick((p) => (p - 1 + many) % many);
          else if (event.key === "Enter") take.current(chosen.current);
          else return false;
          return true;
        },
        attributes: {
          class:
            "min-h-7 text-body-regular text-text-primary focus:outline-none [&_h1]:mt-4 [&_h1]:text-title-3-semibold [&_h2]:mt-3 [&_h2]:text-headline-semibold [&_h3]:mt-3 [&_h3]:text-headline-medium [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-separator-border [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary [&_hr]:my-4 [&_hr]:border-t [&_hr]:border-separator-border [&_code]:rounded-md [&_code]:bg-background-secondary-default [&_code]:px-1 [&_code]:font-mono [&_code]:text-body-2-regular [&_pre]:rounded-2lg [&_pre]:bg-background-secondary-default [&_pre]:p-3 [&>*+*]:mt-3",
          "aria-label": "Body",
        },
      },
      onUpdate: ({ editor: e }) => {
        // Live, what changes is the shared document's, not a draft here.
        if (!joined) edited.current = true;
        setBlank(e.isEmpty);
        // A slash on a line of its own is a menu, and what is typed after
        // it narrows the menu; anything else closes it.
        const { $from } = e.state.selection;
        const asking = ASKING.exec($from.parent.textContent);
        if (asking) {
          const at = e.view.coordsAtPos($from.pos);
          setSlash({
            at: $from.pos,
            word: asking[1]!,
            top: at.top,
            bottom: at.bottom,
          });
          setPick(0);
        } else setSlash(null);
      },
      onSelectionUpdate: ({ editor: e }) => {
        // The menu is the line's: a caret that leaves takes it with it.
        if (!ASKING.test(e.state.selection.$from.parent.textContent)) {
          setSlash(null);
        }
      },
      onBlur: ({ editor: e }) => {
        setSlash(null);
        // Live, the relay saves; nothing is kept from here.
        if (joined || !edited.current) return;
        // One line ending, the one an agent writes, so a body a person
        // touched and a body the agent wrote are the same text. The last
        // that saved is only forgotten once the next one has. Typed and
        // undone is nothing to save.
        edited.current = false;
        const said = markdownOf(e).replace(/\r\n/g, "\n").trim();
        // Unchanged, unless a save is still out that would change it.
        if (said === kept.current && !saving.current) return;
        const want = e.state.doc.textContent;
        const save = onKeep(said, base.current).then(async (landed) => {
          if (typeof landed === "number") {
            kept.current = said;
            base.current = landed;
            // Typed on since: what is offered waits for that to be saved
            // too, by the handoff.
            const doc = offered.current?.doc;
            if (doc && !edited.current) {
              await says(doc, want, 6000);
              if (!edited.current) setJoined(offered.current);
            }
          }
          // A save that fell behind gives way to what the page has, which
          // may have arrived while the person was still in the text — unless
          // they are back in it, or have written on since, when leaving it
          // again settles it, or the text is the relay's document by now.
          else if (
            landed === "behind" &&
            !joinedNow.current &&
            !e.isDestroyed &&
            !e.isFocused &&
            spelled(markdownOf(e)) === spelled(said)
          )
            adopt(e, latest.current, true);
          // A save that did not land leaves the body changed, so leaving
          // it again tries once more.
          else edited.current = true;
        });
        saving.current = save;
        void save.finally(() => {
          if (saving.current === save) saving.current = null;
        });
      },
    },
    [canEdit, joined?.doc],
  );

  // Under the line, or over it when the window has more room over. How tall
  // the menu stands is measured, never assumed — it changes with what is
  // typed after the slash — and it never stands taller than the room it has.
  useLayoutEffect(() => {
    if (!slash || !menu.current) return;
    const tall = menu.current.scrollHeight;
    const top = box.current?.getBoundingClientRect().top ?? 0;
    const below = window.innerHeight - slash.bottom - 8;
    const above = slash.top - 8;
    const under = below >= tall || below >= above;
    const room = Math.max(120, under ? below : above);
    setHangs({
      top: under
        ? slash.bottom - top + 4
        : slash.top - top - Math.min(tall, room) - 4,
      max: room,
    });
  }, [slash]);

  // Takes the page's body as what is shown, resting on the page's change.
  // Asked for outright, it replaces the text whatever it says; otherwise
  // a body the page already had is left alone.
  const adopt = (
    e: Editor,
    page: { body: string; seen: number },
    outright = false,
  ) => {
    base.current = page.seen;
    if (!outright && page.body === kept.current) return;
    kept.current = page.body;
    setText(page.body);
    e.commands.setContent(page.body, { emitUpdate: false });
    edited.current = false;
    setBlank(e.isEmpty);
    // What arrived may be something the editor cannot hold, so it is asked
    // again of every body, not only the first.
    setWhole(holds(e, page.body));
  };

  // A body rewritten elsewhere — by the agent, or in another window —
  // replaces what is shown, unless the person is in the middle of it. The
  // text on screen then rests on the page's change, the same text or not.
  // A page older than what the text already rests on is not followed: the
  // refresh a landed save asked for is still on its way.
  useEffect(() => {
    if (editor && !editor.isDestroyed)
      editor.setEditable(canEdit && !joining && !handing, false);
  }, [editor, canEdit, joining, handing]);

  // The offered document is taken once nothing typed alone is unsaved: a
  // draft in the text is saved first, and taken up after it lands; one
  // that will not land keeps the text alone until a later save does.
  // The text box's focus does not outlive the text box.
  useEffect(() => {
    if (whole || joined) typing.current = false;
  }, [whole, joined]);

  useEffect(() => {
    if (live === joined || handing || paused.current) return;
    if (!live) {
      // The socket dropped: what the live text says is kept for the text
      // alone, resting on the page's change.
      // A reader has no draft: what they watched was someone else's. Text
      // the page already has was saved, and rests on the page's change;
      // text it does not is kept, resting on the change the page had when
      // the socket opened, so saving it cannot write over what landed
      // meanwhile without asking.
      const e = ed.current;
      if (joined && canEdit && e && !e.isDestroyed) {
        const said = markdownOf(e).replace(/\r\n/g, "\n").trim();
        kept.current = latest.current.body;
        if (exact(said) === exact(latest.current.body)) {
          parting.current = null;
          base.current = latest.current.seen;
        } else {
          parting.current = said;
          base.current = joinedAt.current;
        }
      }
      // Nothing of the live document's is a draft of this text's.
      edited.current = false;
      return setJoined(null);
    }
    joinedAt.current = latest.current.seen;
    const e = ed.current;
    if (!e || e.isDestroyed || joined || !canEdit) return setJoined(live);
    // A save the person set going by leaving the text lands first.
    if (saving.current) {
      setHanding(true);
      void saving.current.finally(() => {
        saving.current = null;
        setHanding(false);
      });
      return;
    }
    if (!edited.current) return setJoined(live);
    // The draft as the person sees it: the text box's, when the body is
    // one the editor could not hold. One that says what was already kept
    // — typed and undone — has nothing to save.
    const said = whole
      ? markdownOf(e).replace(/\r\n/g, "\n").trim()
      : textNow.current.trim();
    if (said === kept.current || exact(said) === exact(latest.current.body)) {
      // The page has it already — the relay saved it before the socket
      // dropped — so the text rests on the page's change.
      kept.current = latest.current.body;
      base.current = latest.current.seen;
      edited.current = false;
      return setJoined(live);
    }
    setHanding(true);
    edited.current = false;
    const want = whole ? e.state.doc.textContent : said;
    void keep.current(said, base.current).then(async (landed) => {
      if (typeof landed === "number") {
        kept.current = said;
        base.current = landed;
        // Typed on before the text was held: saved by another round.
        const now = whole
          ? markdownOf(e).replace(/\r\n/g, "\n").trim()
          : textNow.current.trim();
        if (!e.isDestroyed && now !== said) {
          edited.current = true;
          return setHanding(false);
        }
        // The relay's document is taken only once it says the draft too,
        // which it does within a couple of seconds of the save; a document
        // that never does is taken anyway, since the brain has the draft.
        const doc = offered.current?.doc;
        if (doc) await says(doc, want, 6000);
        setJoined(offered.current);
        return setHanding(false);
      }
      // Fell behind: the page holds the draft for the person's choice, and
      // the text joins. Not saved at all: another try, in a while.
      if (landed === "behind") {
        setJoined(offered.current);
        return setHanding(false);
      }
      edited.current = true;
      paused.current = true;
      setHanding(false);
      setTimeout(() => {
        paused.current = false;
        setTries((n) => n + 1);
      }, 5000);
    });
  }, [live, joined, whole, handing, canEdit, tries]);

  // Live, the relay's document is what is shown, and the page's body is
  // not followed at all.
  // Nor is a draft not yet saved — after a socket dropped, or a save that
  // did not land — written over by what the page has.
  useEffect(() => {
    if (joined || !editor || editor.isDestroyed) return;
    if (editor.isFocused || typing.current) return;
    if (parting.current !== null || seen < base.current) return;
    if (edited.current) {
      // A draft that says what the page now says was saved after all; one
      // the page has since outgrown — a body the editor cannot hold — is
      // given up for it, since that is the newer thing.
      const draft = whole ? markdownOf(editor) : textNow.current;
      const same = exact(draft) === exact(body);
      // A body that did not move — a title or a field did — outgrows no
      // draft, whatever the editor can hold of it.
      if (!same && (body === kept.current || survives(editor, body))) return;
      edited.current = false;
      if (!same) {
        setText(body);
        setWhole(false);
      }
    }
    adopt(editor, { body, seen });
  }, [body, seen, editor, joined, whole]);
  useEffect(() => {
    if (!put || put.n === putDone.current) return;
    // Live, the relay's document says what the choice made of the brain;
    // the choice is spent all the same.
    if (joined) {
      putDone.current = put.n;
      return;
    }
    if (editor && !editor.isDestroyed) {
      putDone.current = put.n;
      adopt(editor, put, true);
    }
  }, [put, editor, joined]);

  const state = joined ? "live" : joining ? "joining" : "off";
  if (!canEdit) {
    if (!joined) return <Markdown>{body}</Markdown>;
    return (
      <div className="min-h-7" data-live={state}>
        <EditorContent editor={editor} />
      </div>
    );
  }
  if (!whole && !joined)
    return (
      <Textarea
        size="small"
        aria-label="Body"
        rows={4}
        autoResize
        isReadOnly={joining || handing}
        value={text}
        onChange={(v) => {
          edited.current = true;
          setText(v);
        }}
        onFocus={() => {
          typing.current = true;
        }}
        onBlur={() => {
          typing.current = false;
          if (!edited.current) return;
          edited.current = false;
          const said = text.trim();
          if (said === kept.current && !saving.current) return;
          const save = onKeep(said, base.current).then((landed) => {
            if (typeof landed === "number") {
              kept.current = said;
              base.current = landed;
            } else if (
              landed === "behind" &&
              !joinedNow.current &&
              ed.current &&
              !ed.current.isDestroyed &&
              !typing.current &&
              textNow.current.trim() === said
            )
              adopt(ed.current, latest.current, true);
            else edited.current = true;
          });
          saving.current = save;
          void save.finally(() => {
            if (saving.current === save) saving.current = null;
          });
        }}
        fieldClassName="rounded-none bg-transparent p-0 ring-0 [&_textarea]:px-0"
      />
    );

  // What the menu offers, narrowed by what has been typed after the slash.
  const shown = slash
    ? INSERTS.filter((i) =>
        i.name.toLowerCase().includes(slash.word.toLowerCase()),
      )
    : INSERTS;
  choices.current = shown;
  const at = Math.min(pick, Math.max(0, shown.length - 1));
  chosen.current = at;
  const choose = (i: number) => {
    const insert = shown[i];
    if (!editor || !slash || !insert) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: slash.at - 1 - slash.word.length, to: slash.at })
      .run();
    insert.run(editor);
    setSlash(null);
  };
  take.current = choose;

  return (
    <div
      ref={box}
      data-live={state}
      className="relative min-h-12"
      onMouseDown={(e) => {
        // The room under the last line belongs to the body: a click in it
        // carries on writing rather than doing nothing.
        if (e.target !== e.currentTarget || !editor) return;
        e.preventDefault();
        editor.commands.focus("end");
      }}
    >
      {blank && (
        <p className="pointer-events-none absolute inset-x-0 top-0 text-body-regular text-text-tertiary">
          Start writing, or type / for commands
        </p>
      )}
      <EditorContent editor={editor} />
      {slash && shown.length > 0 && (
        <div
          ref={menu}
          role="listbox"
          aria-label="Insert"
          style={{ top: hangs.top, maxHeight: hangs.max || undefined }}
          className={cx(
            MENU_POPOVER_SURFACE,
            "absolute left-0 z-30 flex w-60 flex-col gap-1 p-2",
          )}
        >
          <span className="px-2 py-1 text-caption-1-semibold text-text-secondary">
            Insert
          </span>
          {shown.map((i, n) => (
            <button
              key={i.name}
              type="button"
              role="option"
              aria-selected={n === at}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(n);
              }}
              onMouseEnter={() => setPick(n)}
              className={cx(
                MENU_ITEM,
                "min-h-10 text-body-medium",
                n === at ? MENU_ITEM_ACTIVE : MENU_ITEM_INTERACTIVE,
              )}
            >
              <i.mark
                className="size-5 shrink-0 text-foreground-icon-secondary"
                aria-hidden
              />
              {i.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
