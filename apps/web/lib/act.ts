import { NextResponse } from "next/server";

import { DiskError } from "./disk.ts";
import { cleanPath, FileRejected } from "./files.ts";
import { origin } from "./origin.ts";

// A form's action on the disk: done, then back to the folder it was sent
// from, with what happened in the address. A refusal by the disk or by
// the file is said there too, never thrown at the person.
export async function act(
  request: Request,
  run: (form: FormData, at: string) => Promise<string>,
): Promise<Response> {
  const form = await request.formData();
  const at = cleanPath(form.get("path") ?? "/");
  if (!at) return new Response("Not a path.", { status: 400 });
  let outcome: string;
  try {
    outcome = await run(form, at);
  } catch (err) {
    if (err instanceof DiskError || err instanceof FileRejected)
      outcome = `error=${encodeURIComponent(err.message)}`;
    else throw err;
  }
  return NextResponse.redirect(
    `${origin(request)}/computer?path=${encodeURIComponent(at)}&${outcome}`,
    303,
  );
}
