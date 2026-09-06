import type { Principal } from "@placeholder/db/auth";
import {
  backupInProgress,
  backupOf,
  backupsIn,
  backupsOpen,
  beginBackup,
  computerByMachine,
  dropBackup,
  finishBackup,
  memberLive,
} from "@placeholder/db/backups";
import {
  computersAllowedIn,
  computersIn,
  noteEvent,
  principalIn,
  type Computer,
} from "@placeholder/db/computers";
import fs from "node:fs/promises";

import { deployment } from "./deployment.ts";
import { disk, site } from "./disk.ts";
import {
  dropBytes,
  localClaim,
  localFilePath,
  localPartPath,
  localToken,
} from "./files.ts";
import { beginMultipart, completeMultipart, presign, remove } from "./s3.ts";

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
  const uploadId =
    deployment.storage.kind === "s3"
      ? await beginMultipart(deployment.storage, key, "application/gzip")
      : null;
  const id = await beginBackup(m, key, uploadId);
  if (!id) {
    if (deployment.storage.kind === "s3" && uploadId)
      await remove(deployment.storage, key, uploadId);
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
  // No more parts than the disk could fill, at the size the machine cuts
  // them: sixteen mebibytes, or larger on a disk too big to fit in ten
  // thousand of those.
  const MIN_PART = 16 * 1024 * 1024;
  const most = Math.min(
    10_000,
    Math.ceil(
      (m.diskGb * 1e9 * 2) /
        Math.max(
          MIN_PART,
          Math.ceil((m.diskGb * 1e9 * 2) / 10_000 / MIN_PART) * MIN_PART,
        ),
    ),
  );
  if (!b || !(partNumber >= 1 && partNumber <= most)) return null;
  if (deployment.storage.kind === "s3")
    return presign(deployment.storage, "PUT", b.key, {
      partNumber: String(partNumber),
      uploadId: b.uploadId!,
    });
  return `${site()}/computer/backup/local/${localToken(b.key, partNumber, Date.now() + 3600_000, `${m.orgId}|${m.userId}|${id}`)}`;
}

export async function complete(
  m: Machine,
  id: string,
  parts: { partNumber: number; etag: string }[],
): Promise<boolean> {
  const b = await backupInProgress(m, id);
  if (!b) return false;
  let size: number;
  if (deployment.storage.kind === "s3") {
    size = await completeMultipart(
      deployment.storage,
      b.key,
      b.uploadId!,
      parts,
    );
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
    await dropBytes({ key: b.key, state: "ready", uploadId: null });
    await abort(m, id);
    return false;
  }
  if (!(await finishBackup(m, id, size))) {
    // Dropped while it was being closed: the whole object goes now.
    await dropBytes({ key: b.key, state: "ready", uploadId: null });
    return false;
  }
  return true;
}

// Lets go of a backup's bytes, finished or not, then marks the row.
async function drop(
  orgId: string,
  b: { id: string; key: string; uploadId: string | null },
): Promise<void> {
  await dropBytes({
    key: b.key,
    state: b.uploadId ? "uploading" : "ready",
    uploadId: b.uploadId,
  });
  await dropBackup(orgId, b.id);
}

// A machine giving up on a backup; or, named none, on every one it had
// on its way, as a machine that boots has.
export async function abort(m: Machine, id: string): Promise<void> {
  const open = id
    ? [await backupInProgress(m, id)].filter((b) => b !== null)
    : await backupsOpen(m);
  for (const b of open) await drop(m.orgId, b);
}

// Has this computer back itself up now, and notes that as why the
// machine is awake; the machine carries on alone.
export async function backUp(orgId: string, c: Computer): Promise<void> {
  await noteEvent(orgId, c, "backup");
  await disk.backupIn(orgId, c);
}

// The sweep's part: every running member's machine backs up once a day,
// the eighth and older go, and one that never finished within a day goes
// too. A machine that should be off — the org's computers off, the
// membership ended — is not woken for it.
export async function sweepBackups(orgId: string, now: Date): Promise<void> {
  if (deployment.storage.kind === "none" || deployment.computers.kind !== "fly")
    return;
  const { lastFinished, running, surplus, stale } = await backupsIn(orgId);
  for (const b of [...surplus, ...stale])
    await drop(orgId, b).catch((err) =>
      console.error(`backup ${b.id}: ${(err as Error).message}`),
    );
  if (!(await computersAllowedIn(orgId))) return;
  for (const c of await computersIn(orgId)) {
    if (!c.machineId || c.offAt || running.has(c.userId)) continue;
    if (!(await principalIn(orgId, c.userId))) continue;
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
