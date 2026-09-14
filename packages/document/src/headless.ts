import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { Window } from "happy-dom";
import type * as Y from "yjs";

import { extensions, survives } from "./extensions.ts";

// The editor needs a document to live in; in Node it is given one, once:
// a window that loads nothing and goes nowhere, since what is parsed in
// it is whatever a person wrote.
function dom() {
  const g = globalThis as Record<string, unknown>;
  if (g.document) return;
  const w = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableComputedStyleRendering: true,
      navigation: {
        disableMainFrameNavigation: true,
        disableChildFrameNavigation: true,
      },
    },
  });
  for (const k of [
    "window",
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "Text",
    "DOMParser",
    "MutationObserver",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    Object.defineProperty(g, k, {
      value: (w as unknown as Record<string, unknown>)[k],
      configurable: true,
      writable: true,
    });
  }
}

// A record's body held in a shared document, with no screen: the same
// editor the page runs, reading and writing the same markdown, bound to
// the fragment every other editor of the record is bound to.
export function headless(doc: Y.Doc) {
  dom();
  const editor = new Editor({
    extensions: [
      ...extensions({ undoRedo: false }),
      Collaboration.configure({ document: doc }),
    ],
  });
  const store = editor.storage as unknown as {
    markdown: { getMarkdown(): string };
  };
  return {
    editor,
    // The body as markdown, with one line ending.
    markdown: () => store.markdown.getMarkdown().replace(/\r\n/g, "\n").trim(),
    // Replaces the body with this markdown, for everyone bound to it.
    set: (md: string) => editor.commands.setContent(md, { emitUpdate: false }),
    // Whether this markdown would come back as it went in.
    holds: (md: string) => survives(editor, md),
    destroy: () => editor.destroy(),
  };
}
