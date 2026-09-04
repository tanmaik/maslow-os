import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { deployment } from "@/lib/deployment";
import {
  localClaim,
  localPartPath,
  localStagedStream,
  PART_SIZE,
  stillUploading,
} from "@/lib/files";

// Stands in for the bucket on a real machine: takes one part of an upload,
// let in by a token we signed, streamed to disk and no larger than a part;
// and hands the staged whole to the machine fetching it, by a token for
// part 0. Never on a deployment with a bucket.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (deployment.storage.kind !== "local")
    return new Response(null, { status: 404 });
  const claim = localClaim((await params).token);
  if (!claim || claim.part !== 0) return new Response(null, { status: 403 });
  const staged = await localStagedStream(claim);
  if (!staged) return new Response(null, { status: 404 });
  return new Response(staged.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(staged.size),
    },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (deployment.storage.kind !== "local")
    return new Response(null, { status: 404 });
  const claim = localClaim((await params).token);
  if (!claim || claim.part < 1 || !(await stillUploading(claim)))
    return new Response(null, { status: 403 });
  if (!request.body) return new Response(null, { status: 400 });
  const target = localPartPath(claim.key, claim.part);
  await fs.mkdir(path.dirname(target), { recursive: true });
  let total = 0;
  const bounded = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.length;
      if (total > PART_SIZE) controller.error(new Error("part too large"));
      else controller.enqueue(chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(request.body.pipeThrough(bounded) as never),
      createWriteStream(target),
    );
  } catch {
    await fs.rm(target, { force: true });
    return new Response("A part is at most 64 MB.", { status: 413 });
  }
  // Checked again once written: an upload expired meanwhile leaves no part.
  if (!(await stillUploading(claim))) {
    await fs.rm(target, { force: true });
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 200,
    headers: { etag: `"part-${claim.part}"` },
  });
}
