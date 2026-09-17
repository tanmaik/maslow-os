import { sharedHref } from "@/app/computer/files/kinds";

// A file put into a shared folder, or over a shared file, by a colleague
// at edit: to an address in the bucket signed for exactly its bytes, which
// the browser puts to itself and then says landed; or, where nothing signs
// addresses, through our server. How far it has got is reported as it
// goes. Throws with what went wrong.
export async function putShared(
  id: string,
  path: string,
  file: File,
  sent: (bytes: number) => void,
): Promise<void> {
  const where = sharedHref(id, "upload", path);
  const ask = await fetch(where, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bytes: file.size }),
  });
  if (!ask.ok) throw new Error((await ask.text()) || "It was not taken.");
  const to = (await ask.json()) as { key: string; url: string } | null;
  if (to) {
    await put(to.url, file, sent);
    const said = await fetch(where, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-maslow-upload": "landed",
      },
      body: JSON.stringify({ key: to.key }),
    });
    if (!said.ok) throw new Error((await said.text()) || "It was not taken.");
    return;
  }
  await put(where, file, sent);
}

// One file sent whole with the bytes it has written reported as they go.
const put = (url: string, body: Blob, sent: (bytes: number) => void) =>
  new Promise<void>((resolve, reject) => {
    const call = new XMLHttpRequest();
    call.open("PUT", url);
    call.upload.onprogress = (e) => sent(e.loaded);
    call.onload = () =>
      call.status >= 200 && call.status < 300
        ? resolve()
        : reject(new Error(call.responseText || "It was not taken."));
    call.onerror = () => reject(new Error("The connection dropped."));
    call.onabort = () => reject(new Error("The connection dropped."));
    call.send(body);
  });
