// What a purge does at a vendor: empties a prefix of the bucket, or
// destroys every machine and volume in a Fly app named with a prefix. The
// preview lifecycle, the nightly reap and teardown all purge this way.
import { s3, unescapeXml } from "../apps/web/lib/s3.ts";

// Removes every object under the prefix, and every upload begun there and
// never finished, which is billed too. Returns how many went.
export async function emptyPrefix(cfg, prefix) {
  let removed = 0;
  for (;;) {
    const r = await s3(cfg, "GET", "", undefined, undefined, {
      "list-type": "2",
      prefix,
      "max-keys": "1000",
    });
    if (!r.ok) throw new Error(`bucket list → ${r.status}`);
    const found = [...(await r.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map(
      (m) => unescapeXml(m[1]),
    );
    for (const key of found) {
      const d = await s3(cfg, "DELETE", key);
      if (!d.ok && d.status !== 404)
        throw new Error(`bucket delete → ${d.status}`);
      removed++;
    }
    if (found.length < 1000) break;
  }
  let markers = {};
  for (;;) {
    const u = await s3(cfg, "GET", "", undefined, undefined, {
      uploads: "",
      prefix,
      ...markers,
    });
    if (!u.ok) throw new Error(`bucket uploads list → ${u.status}`);
    const xml = await u.text();
    for (const m of xml.matchAll(
      /<Upload>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<UploadId>([^<]+)<\/UploadId>[\s\S]*?<\/Upload>/g,
    )) {
      const a = await s3(
        cfg,
        "DELETE",
        unescapeXml(m[1]),
        undefined,
        undefined,
        {
          uploadId: m[2],
        },
      );
      if (!a.ok && a.status !== 404)
        throw new Error(`bucket abort → ${a.status}`);
      removed++;
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    markers = {
      "key-marker": unescapeXml(
        /<NextKeyMarker>([^<]*)<\/NextKeyMarker>/.exec(xml)?.[1] ?? "",
      ),
      "upload-id-marker":
        /<NextUploadIdMarker>([^<]*)<\/NextUploadIdMarker>/.exec(xml)?.[1] ??
        "",
    };
  }
  return removed;
}

// Destroys the app's machines whose names start with the prefix, waiting
// for each to go, then its volumes, whose names carry the same prefix with
// underscores. An empty prefix is the whole app. Returns how many went.
export async function destroyMachines(
  { token, app, api = "https://api.machines.dev" },
  prefix,
) {
  const call = async (method, path, allow404 = false) => {
    const r = await fetch(`${api}/v1/apps/${app}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
    if (r.status === 404 && allow404) return null;
    if (!r.ok) throw new Error(`fly ${method} ${path} → ${r.status}`);
    return r.json();
  };
  let gone = 0;
  for (const m of (await call("GET", "/machines")).filter((m) =>
    m.name.startsWith(prefix),
  )) {
    await call("DELETE", `/machines/${m.id}?force=true`, true);
    let still;
    for (let i = 0; i < 60; i++) {
      still = await call("GET", `/machines/${m.id}`, true);
      if (!still || still.state === "destroyed") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (still && still.state !== "destroyed")
      throw new Error(`fly: machine ${m.id} did not go within a minute`);
    gone++;
  }
  // A volume detaches a moment after its machine is gone.
  for (const v of (await call("GET", "/volumes")).filter((v) =>
    v.name.startsWith(prefix.replaceAll("-", "_")),
  )) {
    let last;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await call("DELETE", `/volumes/${v.id}`, true);
        last = null;
        break;
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (last) throw last;
    gone++;
  }
  return gone;
}
