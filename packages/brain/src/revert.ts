import { Conflict, Invalid, NotFound } from "./errors.ts";
import { check, defineProperty, propertiesOf } from "./properties.ts";
import { eventColumns, toEvent, type EventRow } from "./rows.ts";
import type { Author, PropertyType, Query } from "./types.ts";
import {
  redefine,
  redefineProperty,
  removeProperty,
  restoreDefinition,
  undefine,
} from "./vocabulary.ts";
import { remove, restoreEdge, unlink } from "./write.ts";

// Walking a change back from the log. A person's changes are numbered from
// one; the latest change to a thing is the one that can be walked back, so
// nothing made since is lost, and the walk-back is one more line in the
// log. Shares and memberships are changed in settings, not here.

type Row = Record<string, unknown>;

export async function revert(
  q: Query,
  author: Author,
  n: number,
): Promise<string> {
  const { rows } = await q.query<EventRow>(
    `select ${eventColumns} from events
     where person_id = current_member() and n = $1`,
    [n],
  );
  if (!rows[0]) throw new NotFound(`no change #${n} of yours`);
  const e = toEvent(rows[0]);
  const later = await q.query<{ n: string }>(
    `select n from events
     where subject_id = $1 and seq > $2 and person_id = current_member()
     order by seq desc limit 1`,
    [e.subjectId, e.seq],
  );
  if (later.rows[0]) {
    throw new Conflict(
      `#${n} is not the latest change to that ${e.subject}; walk back #${later.rows[0].n} first`,
    );
  }
  await q.query("select set_config('app.author', $1, true)", [author]);
  const before = (e.before ?? {}) as Row;
  const after = (e.after ?? {}) as Row;
  const id = e.subjectId;
  const text = (row: Row, key: string) => String(row[key] ?? "");

  switch (e.subject) {
    case "record": {
      if (e.action === "created") {
        await remove(q, author, id);
        return `removed record ${id}`;
      }
      const kind = text(before, "kind");
      const props = (before.props ?? {}) as Row;
      check(kind, props, await propertiesOf(q, kind, undefined, true));
      const result = await q
        .query(
          `update records
           set kind = $2, title = $3, body = $4, props = $5::jsonb,
               occurred_at = $6, confidence = $7, deleted_at = $8,
               merged_into = $9, author = $10
           where id = $1 and person_id = current_member()`,
          [
            id,
            kind,
            text(before, "title"),
            text(before, "body"),
            JSON.stringify(props),
            before.occurred_at ?? null,
            before.confidence ?? null,
            before.deleted_at ?? null,
            before.merged_into ?? null,
            author,
          ],
        )
        .catch((err) => {
          if ((err as { code?: string }).code === "23503") {
            throw new Invalid(`no kind "${kind}" now; restore it first`);
          }
          throw err;
        });
      if (!result.rowCount) throw new NotFound(`record ${id} is not yours`);
      return `record ${id} as before #${n}`;
    }
    case "edge": {
      if (e.action === "created") {
        await unlink(q, author, id);
        return `unlinked ${id}`;
      }
      if (e.action === "deleted") {
        await restoreEdge(q, author, id);
        return `restored edge ${id}`;
      }
      const result = await q.query(
        `update edges
         set props = $2::jsonb, confidence = $3, occurred_at = $4, author = $5
         where id = $1 and person_id = current_member()`,
        [
          id,
          JSON.stringify(before.props ?? {}),
          before.confidence ?? null,
          before.occurred_at ?? null,
          author,
        ],
      );
      if (!result.rowCount) throw new NotFound(`edge ${id} is not yours`);
      return `edge ${id} as before #${n}`;
    }
    case "kind":
    case "verb": {
      const what = e.subject;
      if (e.action === "created" || (before.deleted_at && !after.deleted_at)) {
        await undefine(q, author, what, text(after, "name"));
        return `removed ${what} ${text(after, "name")}`;
      }
      if (e.action === "deleted") {
        await restoreDefinition(q, author, what, text(after, "name"));
        return `restored ${what} ${text(after, "name")}`;
      }
      const was = await redefine(q, author, what, text(after, "name"), {
        newName: text(before, "name"),
        description: text(before, "description"),
      });
      return `${what} ${was.name} as before #${n}`;
    }
    case "property": {
      const kind = text(after.kind === undefined ? before : after, "kind");
      if (e.action === "created") {
        const gone = await removeProperty(q, author, kind, text(after, "name"));
        return `removed field ${kind}.${text(after, "name")} from ${gone} records`;
      }
      const definition = {
        name: text(before, "name"),
        type: text(before, "type") as PropertyType,
        description: text(before, "description"),
        required: Boolean(before.required),
        options: (before.options as string[] | null) ?? undefined,
      };
      if (e.action === "deleted") {
        await defineProperty(q, author, text(before, "kind"), definition);
        return `restored field ${text(before, "kind")}.${definition.name}`;
      }
      const was = await redefineProperty(q, author, kind, text(after, "name"), {
        ...definition,
        newName: definition.name,
      });
      return `field ${kind}.${was.name} as before #${n}`;
    }
    default:
      throw new Invalid(
        `a ${e.subject} is changed in settings, not walked back`,
      );
  }
}
