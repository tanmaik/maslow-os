import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { localArchive } from "@/lib/backups";
import { deployment } from "@/lib/deployment";

// Stands in for the bucket on a real machine: takes one part of a backup
// by a token we signed, and hands the whole archive back for a restore by
// a token for part 0. Never on a deployment with a bucket.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (deployment.storage.kind !== "local")
    return new Response(null, { status: 404 });
  const claim = await localArchive((await params).token);
  if (!claim?.partPath || !request.body)
    return new Response(null, { status: 403 });
  await fs.mkdir(path.dirname(claim.partPath), { recursive: true });
  let total = 0;
  const bounded = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      total += chunk.length;
      if (total > claim.partSize) controller.error(new Error("part too large"));
      else controller.enqueue(chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(request.body.pipeThrough(bounded) as never),
      createWriteStream(claim.partPath),
    );
  } catch {
    await fs.rm(claim.partPath, { force: true });
    return new Response(null, { status: 413 });
  }
  return new Response(null, {
    status: 200,
    headers: { etag: `"part-${claim.part}"` },
  });
}

export async function GET(
  _: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (deployment.storage.kind !== "local")
    return new Response(null, { status: 404 });
  const claim = await localArchive((await params).token);
  if (!claim || claim.part !== 0) return new Response(null, { status: 403 });
  let handle;
  try {
    handle = await fs.open(claim.wholePath, "r");
  } catch {
    return new Response(null, { status: 404 });
  }
  const { size } = await handle.stat();
  return new Response(
    Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>,
    {
      headers: {
        "content-type": "application/gzip",
        "content-length": String(size),
      },
    },
  );
}
