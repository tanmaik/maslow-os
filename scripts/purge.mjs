// What a purge does at the bucket: empties a prefix, and aborts every
// upload begun there. The preview lifecycle, the nightly reap and teardown
// all purge this way.
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
