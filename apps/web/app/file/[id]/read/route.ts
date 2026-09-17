import { after } from "next/server";

import { served } from "@/app/computer/files/serve";
import { principal } from "@/lib/session";
import { readShared, refreshAfterRead } from "@/lib/shares";

import { opened, refused } from "../opened";

// One file of a shared thing, as it is: streamed from the owner's machine
// while it is up, and its copy is brought up to date behind the answer;
// from the bucket while the machine is off, at an address signed for it.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const got = await opened(request, params);
  if (!got) return new Response("Not found", { status: 404 });
  const p = (await principal())!;
  const name = got.at.split("/").pop() || got.o.file.name;
  try {
    const answer = await readShared(
      p,
      got.o,
      got.at,
      request.headers.get("range") ?? undefined,
    );
    if (!answer) return new Response("Nothing is there.", { status: 404 });
    if ("redirect" in answer) return Response.redirect(answer.redirect, 303);
    after(() => refreshAfterRead(got.o));
    return served(name, answer.stream);
  } catch (err) {
    return refused(err);
  }
}
