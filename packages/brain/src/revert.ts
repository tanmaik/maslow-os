import { Conflict, Invalid, NotFound } from "./errors.ts";
import { check, defineProperty, holdType, propertiesOf } from "./properties.ts";
import { eventColumns, toEvent, type EventRow } from "./rows.ts";
import type { Datatype, Query } from "./types.ts";
import {
  redefineProperty,
  removeProperty,
  removeType,
  renameType,
  restoreType,
} from "./vocabulary.ts";
import { remove, restore, restoreEdge, unlink } from "./write.ts";

// Walking a change back from the log. A person's changes are numbered from
// one; the latest change to a thing is the one that can be walked back, so
// nothing made since is lost, and the walk-back is one more line in the
// log. Shares and memberships are changed in settings, not here.

type Row = Record<string, unknown>;

export async function revert(q: Query, n: number): Promise<string> {
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
  const before = (e.before ?? {}) as Row;
  const after = (e.after ?? {}) as Row;
  const id = e.subjectId;
  const text = (row: Row, key: string) => String(row[key] ?? "");

  switch (e.subject) {
    case "record": {
      if (e.action === "created") {
        await remove(q, id);
        return `removed record ${id}`;
      }
      if (e.action === "deleted") {
        await restore(q, id);
        return `restored record ${id}`;
      }
      const type = text(before, "type");
      if (!(await holdType(q, type, false))) {
        throw new Invalid(`type ${type} is removed; restore it first`);
      }
      const props = (before.props ?? {}) as Row;
      check(type, props, await propertiesOf(q, type, undefined, true));
      const result = await q
        .query(
          `update records
           set type = $2, title = $3, body = $4, props = $5::jsonb,
               deleted_at = $6, merged_into = $7
           where id = $1 and person_id = current_member()`,
          [
            id,
            type,
            text(before, "title"),
            text(before, "body"),
            JSON.stringify(props),
            before.deleted_at ?? null,
            before.merged_into ?? null,
          ],
        )
        .catch((err) => {
          if ((err as { code?: string }).code === "23503") {
            throw new Invalid(`no type "${type}" now; restore it first`);
          }
          throw err;
        });
      if (!result.rowCount) throw new NotFound(`record ${id} is not yours`);
      return `record ${id} as before #${n}`;
    }
    case "edge": {
      if (e.action === "created") {
        await unlink(q, id);
        return `unlinked ${id}`;
      }
      if (e.action === "deleted") {
        await restoreEdge(q, id);
        return `restored edge ${id}`;
      }
      const result = await q.query(
        `update edges
         set verb = $2
         where id = $1 and person_id = current_member()`,
        [id, text(before, "verb")],
      );
      if (!result.rowCount) throw new NotFound(`edge ${id} is not yours`);
      return `edge ${id} as before #${n}`;
    }
    case "type": {
      if (e.action === "created" || (before.deleted_at && !after.deleted_at)) {
        await removeType(q, text(after, "name"));
        return `removed type ${text(after, "name")}`;
      }
      if (e.action === "deleted") {
        await restoreType(q, text(after, "name"));
        return `restored type ${text(after, "name")}`;
      }
      await renameType(q, text(after, "name"), text(before, "name"));
      return `type ${text(before, "name")} as before #${n}`;
    }
    case "property": {
      const type = text(after.type === undefined ? before : after, "type");
      if (e.action === "created") {
        const gone = await removeProperty(q, type, text(after, "name"));
        return `removed field ${type}.${text(after, "name")} from ${gone} records`;
      }
      const definition = {
        name: text(before, "name"),
        datatype: text(before, "datatype") as Datatype,
        required: Boolean(before.required),
        options: (before.options as string[] | null) ?? undefined,
      };
      if (e.action === "deleted") {
        await defineProperty(q, text(before, "type"), definition);
        return `restored field ${text(before, "type")}.${definition.name}`;
      }
      const was = await redefineProperty(q, type, text(after, "name"), {
        ...definition,
        newName: definition.name,
      });
      return `field ${type}.${was.name} as before #${n}`;
    }
    case "verb":
      throw new Invalid("a verb is the word on its edges; change those");
    default:
      throw new Invalid(
        `a ${e.subject} is changed in settings, not walked back`,
      );
  }
}
