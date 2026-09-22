"use client";

import {
  HighlightStyle,
  LanguageDescription,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

// The editor's look: the product's type on its tokens, no frame of its
// own, the whole height it is given. The colours code is written in are
// five turns around the person's own accent, at a lightness that flips
// with the look, so they read on paper and on the dark ground alike.
const look = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "transparent",
    "--cm-ink": "var(--foreground)",
    "--cm-quiet": "var(--muted-foreground)",
    "--cm-wrong": "var(--destructive)",
    "--cm-lightness": "0.45",
    "--cm-keyword": "oklch(from var(--primary) var(--cm-lightness) c h)",
    "--cm-string":
      "oklch(from var(--primary) var(--cm-lightness) c calc(h + 100))",
    "--cm-number":
      "oklch(from var(--primary) var(--cm-lightness) c calc(h + 190))",
    "--cm-name":
      "oklch(from var(--primary) var(--cm-lightness) c calc(h + 250))",
    "--cm-type":
      "oklch(from var(--primary) var(--cm-lightness) c calc(h + 310))",
    // What a selection is painted with: enough of the accent to be seen
    // at a glance on either ground, and never so much that the words in
    // it are lost.
    "--cm-picked": "color-mix(in oklch, var(--primary) 30%, transparent)",
  },
  ".dark &": {
    "--cm-lightness": "0.8",
    "--cm-picked": "color-mix(in oklch, var(--primary) 40%, transparent)",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, monospace",
    lineHeight: "20px",
  },
  "&.cm-focused": { outline: "none" },
  // The first ink of the editor sits on the surface's own inset, 12,
  // where the bar's name and the list's marks sit.
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "none",
    color: "var(--muted-foreground)",
  },
  ".cm-lineNumbers .cm-gutterElement": { paddingLeft: "12px" },
  // The line the caret is on is painted over the selection, so its wash
  // is faint and see-through: a selection still shows on it.
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklch, var(--foreground) 6%, transparent)",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklch, var(--foreground) 6%, transparent)",
  },
  ".cm-content": { caretColor: "var(--foreground)" },
  // The caret is drawn by the editor itself when focused: two pixels of
  // ink, so it is found on a dark ground too.
  ".cm-cursor, .cm-dropCursor": {
    borderLeft: "2px solid var(--foreground)",
  },
  // The shipped theme paints a focused selection through a long
  // descendant chain; ours has to be as particular to be seen at all.
  ".cm-selectionBackground": { background: "var(--cm-picked)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    background: "var(--cm-picked)",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--accent)",
  },
});

// What each of the shipped style's colours becomes in ours: a role, not a
// hue. Anything it adds later falls back to plain ink rather than to a
// colour mixed for a white page.
const OURS: Record<string, string> = {
  "#404740": "var(--cm-quiet)", // meta
  "#708": "var(--cm-keyword)",
  "#219": "var(--cm-number)", // atom, bool, url, label
  "#164": "var(--cm-number)", // literal, inserted
  "#a11": "var(--cm-string)", // string, deleted
  "#e40": "var(--cm-string)", // regexp, escape
  "#00f": "var(--cm-name)", // a name being defined
  "#30a": "var(--cm-ink)", // a local name
  "#085": "var(--cm-type)", // type, namespace
  "#167": "var(--cm-type)", // class
  "#256": "var(--cm-type)", // special name, macro
  "#00c": "var(--cm-name)", // a property being defined
  "#940": "var(--cm-quiet)", // comment
  "#f00": "var(--cm-wrong)", // invalid
};

// The shipped highlighting, tag for tag, in the product's colours.
const colours = HighlightStyle.define(
  defaultHighlightStyle.specs.map((spec) =>
    spec.color === undefined
      ? spec
      : { ...spec, color: OURS[spec.color as string] ?? "var(--cm-ink)" },
  ),
);

// A real editor for a text file: line numbers, colouring for the language
// the file's name says, undo, search, folding, and a finger on a phone
// works as well as a caret. Opens fresh for each file; what is typed goes
// out as it changes.
export function Editor({
  name,
  value,
  onChange,
  readOnly = false,
}: {
  name: string;
  value: string;
  onChange: (text: string) => void;
  // A file the person may only look at: the text is read, never typed in.
  readOnly?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const language = new Compartment();
    const view = new EditorView({
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          basicSetup,
          syntaxHighlighting(colours),
          look,
          EditorView.lineWrapping,
          language.of([]),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
      parent: el,
    });
    const found = LanguageDescription.matchFilename(languages, name);
    let gone = false;
    if (found)
      void found.load().then((support) => {
        if (!gone) view.dispatch({ effects: language.reconfigure(support) });
      });
    return () => {
      gone = true;
      view.destroy();
    };
    // A new file is a new editor; the text it opens with is read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  return <div ref={box} className="h-full min-h-0 overflow-hidden" />;
}
