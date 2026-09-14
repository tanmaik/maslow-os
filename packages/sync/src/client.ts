import { headless } from "@maslow/document/headless";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

// A person in a record's live document, from Node: their own copy of it,
// the socket that keeps it level with the relay's, and an editor on it.
// A socket that closes is a document that is over: the copy is never
// carried into another socket, since the relay rebuilds the document from
// markdown and a copy from before would be merged in twice. Whoever wants
// back in opens anew.
export function open(url: string, record: string, ticket: string) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url,
    name: record,
    document: doc,
    token: ticket,
    onClose: () => provider.disconnect(),
    onAuthenticationFailed: () => provider.disconnect(),
  });
  const editor = headless(doc);
  const once = (...events: string[]) =>
    new Promise<void>((r) => {
      for (const e of events) provider.on(e, () => r());
    });
  return {
    editor,
    provider,
    synced: once("synced"),
    // Put out, or never let in.
    closed: once("close", "authenticationFailed"),
    // Writes at the end of the last line, as typing would.
    type: (text: string) =>
      editor.editor.commands.insertContentAt(
        editor.editor.state.doc.content.size - 1,
        { type: "text", text },
      ),
    close: () => {
      editor.destroy();
      provider.destroy();
    },
  };
}
