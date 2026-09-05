import type { Principal } from "@placeholder/db/auth";
import {
  backupInProgress,
  backupOf,
  backupsIn,
  beginBackup,
  computerByMachine,
  dropBackup,
  finishBackup,
  memberLive,
} from "@placeholder/db/backups";
import {
  computersIn,
  noteCause,
  type Computer,
} from "@placeholder/db/computers";
import fs from "node:fs/promises";
import path from "node:path";

import { deployment } from "./deployment.ts";
import { disk } from "./disk.ts";
import {
  localClaim,
  localFilePath,
  localPartPath,
  localToken,
} from "./files.ts";
import { presign, s3 } from "./s3.ts";

// A backup is the machine's own doing: it asks us, as itself, to open
// one, for somewhere to put each part, and to close it. The bytes go from
// the machine to the bucket and never through us. Seven are kept.
export type Machine = {
  id: string;
  orgId: string;
  userId: string;
  diskGb: number;
};

export async function machineFrom(request: Request): Promise<Machine | null> {
  const secret = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const machineId = request.headers.get("fly-machine-id");
  if (!secret || !machineId) return null;
  return computerByMachine(machineId, secret);
}

const backupKey = (m: Machine, id: string) =>
  `${deployment.storage.kind === "s3" ? deployment.storage.prefix : ""}orgs/${m.orgId}/members/${m.userId}/backups/${id}.tar.gz`;

export async function begin(m: Machine): Promise<{ id: string } | null> {
  if (deployment.storage.kind === "none") return null;
  if (!(await memberLive(m))) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = backupKey(m, stamp);
  let uploadId: string | null = null;
  if (deployment.storage.kind === "s3") {
    const r = await s3(
      deployment.storage,
      "POST",
      key,
      undefined,
      "application/gzip",
      { uploads: "" },
    );
    if (!r.ok) throw new Error(`backup begin → ${r.status}: ${await r.text()}`);
    uploadId =
      (await r.text()).match(/<UploadId>([^<]+)<\/UploadId>/)?.[1] ?? null;
    if (!uploadId) throw new Error("backup begin: no upload id");
  }
  const id = await beginBackup(m, key, uploadId);
  if (!id) {
    if (deployment.storage.kind === "s3" && uploadId)
      await s3(deployment.storage, "DELETE", key, undefined, undefined, {
        uploadId,
      });
    return null;
  }
  return { id };
}

export async function partUrl(
  m: Machine,
  id: string,
  partNumber: number,
): Promise<string | null> {
  const b = await backupInProgress(m, id);
  // No more parts than the disk could fill, at the machine's part size.
  const most = Math.ceil((m.diskGb * 1e9 * 2) / (16 * 1024 * 1024));
  if (!b || !(partNumber >= 1 && partNumber <= Math.min(10000, most)))
    return null;
  if (deployment.storage.kind === "s3")
    return presign(deployment.storage, "PUT", b.key, {
      partNumber: String(partNumber),
      uploadId: b.uploadId!,
    });
  return `${site()}/computer/backup/local/${localToken(b.key, partNumber, Date.now() + 3600_000, `${m.orgId}|${m.userId}|${id}`)}`;
}

// Where a machine reaches us: the origin its reports go to. Without
// computers there is no machine to reach us, and the address is moot.
const site = () =>
  deployment.computers.kind === "fly"
    ? new URL(deployment.computers.report).origin
    : "http://127.0.0.1";

export async function complete(
  m: Machine,
  id: string,
  parts: { partNumber: number; etag: string }[],
): Promise<boolean> {
  const b = await backupInProgress(m, id);
  if (!b) return false;
  let size: number;
  if (deployment.storage.kind === "s3") {
    const xml = `<CompleteMultipartUpload>${parts
      .sort((a, c) => a.partNumber - c.partNumber)
      .map(
        (x) =>
          `<Part><PartNumber>${x.partNumber}</PartNumber><ETag>${x.etag}</ETag></Part>`,
      )
      .join("")}</CompleteMultipartUpload>`;
    const r = await s3(
      deployment.storage,
      "POST",
      b.key,
      new TextEncoder().encode(xml),
      "application/xml",
      { uploadId: b.uploadId! },
    );
    if (!r.ok || /<Error>/.test(await r.text()))
      throw new Error(`backup complete → ${r.status}`);
    const head = await s3(deployment.storage, "HEAD", b.key);
    size = Number(head.headers.get("content-length"));
    if (!head.ok || !(size >= 0))
      throw new Error(`backup complete: the object cannot be read back`);
  } else {
    const out = await fs.open(localFilePath(b.key), "w");
    size = 0;
    for (const x of parts.sort((a, c) => a.partNumber - c.partNumber)) {
      const bytes = await fs.readFile(localPartPath(b.key, x.partNumber));
      await out.write(bytes);
      size += bytes.length;
    }
    await out.close();
    for (const x of parts)
      await fs.rm(localPartPath(b.key, x.partNumber), { force: true });
  }
  // An archive larger than twice the disk is not an archive of it.
  if (size > m.diskGb * 1e9 * 2) {
    await dropObject(b.key);
    await abort(m, id);
    return false;
  }
  if (!(await finishBackup(m, id, size))) {
    // Dropped while it was being closed: the whole object goes now.
    await dropObject(b.key);
    return false;
  }
  return true;
}

async function dropObject(key: string): Promise<void> {
  if (deployment.storage.kind === "s3") {
    const r = await s3(deployment.storage, "DELETE", key);
    if (!r.ok && r.status !== 404)
      throw new Error(`backup delete → ${r.status}`);
  } else if (deployment.storage.kind === "local")
    await fs.rm(localFilePath(key), { force: true });
}

// Lets go of a backup's bytes, finished or not, then marks the row.
export async function drop(
  orgId: string,
  b: { id: string; key: string; uploadId: string | null },
): Promise<void> {
  if (deployment.storage.kind === "s3") {
    const r = b.uploadId
      ? await s3(deployment.storage, "DELETE", b.key, undefined, undefined, {
          uploadId: b.uploadId,
        })
      : await s3(deployment.storage, "DELETE", b.key);
    if (!r.ok && r.status !== 404)
      throw new Error(`backup delete → ${r.status}`);
  } else if (deployment.storage.kind === "local") {
    await fs.rm(localFilePath(b.key), { force: true });
    const dir = path.dirname(localFilePath(b.key));
    const stem = path.basename(localFilePath(b.key));
    for (const name of await fs.readdir(dir).catch(() => [] as string[]))
      if (name.startsWith(`${stem}.part`))
        await fs.rm(path.join(dir, name), { force: true });
  }
  await dropBackup(orgId, b.id);
}

export async function abort(m: Machine, id: string): Promise<void> {
  const b = await backupInProgress(m, id);
  if (b) await drop(m.orgId, b);
}

// Has this computer back itself up now, and notes that as why the
// machine is awake; the machine carries on alone.
export async function backUp(orgId: string, c: Computer): Promise<void> {
  await noteCause(orgId, c, "backup");
  await disk.backupIn(orgId, c);
}

// The sweep's part: every machine backs up once a day, the eighth and
// older go, and one that never finished within a day goes too.
export async function sweepBackups(orgId: string, now: Date): Promise<void> {
  if (deployment.storage.kind === "none" || deployment.computers.kind !== "fly")
    return;
  const { lastFinished, running, surplus, stale } = await backupsIn(orgId);
  for (const b of [...surplus, ...stale])
    await drop(orgId, b).catch((err) =>
      console.error(`backup ${b.id}: ${(err as Error).message}`),
    );
  for (const c of await computersIn(orgId)) {
    if (!c.machineId || running.has(c.userId)) continue;
    const last = lastFinished.get(c.userId);
    if (last && now.getTime() - last.getTime() < 86400_000) continue;
    await backUp(orgId, c).catch((err) =>
      console.error(`backup ${c.machineId}: ${(err as Error).message}`),
    );
  }
}

// Where the machine fetches an archive from, for a restore.
export async function restoreUrl(
  p: Principal,
  id: string,
): Promise<string | null> {
  const b = await backupOf(p, id);
  if (!b) return null;
  if (deployment.storage.kind === "s3")
    return presign(deployment.storage, "GET", b.key, {}, 86400);
  return `${site()}/computer/backup/local/${localToken(b.key, 0, Date.now() + 86400_000, `${p.orgId}|${p.userId}|${id}`)}`;
}

// The archive a local token names, whole or a part of it; a part only for
// a backup still on its way.
export async function localArchive(token: string) {
  const claim = localClaim(token);
  if (!claim) return null;
  if (
    claim.part &&
    !(await backupInProgress(
      { orgId: claim.orgId, userId: claim.userId },
      claim.id,
    ))
  )
    return null;
  return {
    ...claim,
    partPath: claim.part ? localPartPath(claim.key, claim.part) : null,
    wholePath: localFilePath(claim.key),
    // The machine cuts an archive into parts of its own size, whatever a
    // browser's parts are.
    partSize: 64 * 1024 * 1024,
  };
}
