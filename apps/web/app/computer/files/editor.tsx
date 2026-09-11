"use client";

import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

// The editor's look: the product's type on its tokens, no frame of its
// own, the whole height it is given.
const look = EditorView.theme({
  "&": { height: "100%", fontSize: "12px", backgroundColor: "transparent" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
    lineHeight: "20px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "none",
    color: "var(--muted-foreground)",
  },
  ".cm-activeLine": { backgroundColor: "var(--muted)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--muted)" },
  ".cm-content": { caretColor: "var(--foreground)" },
});

// A real editor for a text file: line numbers, colouring for the language
// the file's name says, undo, search, folding, and a finger on a phone
// works as well as a caret. Opens fresh for each file; what is typed goes
// out as it changes.
export function Editor({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange: (text: string) => void;
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
          look,
          EditorView.lineWrapping,
          language.of([]),
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
