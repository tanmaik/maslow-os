import type { BrainType, ShareRequest, Stub } from "@maslow/brain";
import type { Group } from "@maslow/db/groups";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

import { recordHref, typeHref } from "./format";

// What the agent asked to share, each ask as a sentence a person can say
// yes or no to.
export function Asks({
  asks,
  records,
  types,
  people,
  groups,
}: {
  asks: ShareRequest[];
  records: Map<string, Stub>;
  types: BrainType[];
  people: Map<string, string>;
  groups: Group[];
}) {
  if (asks.length === 0) return null;
  const may = {
    view: "see",
    edit: "see and change",
    owner: "do everything with",
  };
  return (
    <div className="space-y-3">
      {asks.map((a) => (
        <Card key={a.id} className="py-4">
          <CardContent className="space-y-3 px-4 text-sm">
            <p>
              Your agent asks to let{" "}
              <b>
                {list(
                  a.subjects.map((s) =>
                    s.who === "everyone"
                      ? "everyone in the org"
                      : s.who === "group"
                        ? (groups.find((g) => g.id === s.id)?.name ??
                          "a group no longer here")
                        : (people.get(s.id) ?? "someone no longer here"),
                  ),
                )}
              </b>{" "}
              {may[a.level]}{" "}
              {list(
                a.items.map((it, i) =>
                  "record" in it ? (
                    <Link
                      key={i}
                      href={recordHref(it.record)}
                      className="font-medium underline"
                    >
                      {records.get(it.record)?.title || "a record"}
                    </Link>
                  ) : (
                    <Link
                      key={i}
                      href={typeHref(types.find((t) => t.id === it.type)?.name)}
                      className="font-medium underline"
                    >
                      every{" "}
                      {types.find((t) => t.id === it.type)?.name ??
                        "record of a type"}
                    </Link>
                  ),
                ),
              )}
              .
            </p>
            <p className="text-muted-foreground">{a.reason}</p>
            <form action="/brain/requests" method="post" className="flex gap-2">
              <input type="hidden" name="request" value={a.id} />
              <Button type="submit" size="sm" name="intent" value="accept">
                Share
              </Button>
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                name="intent"
                value="decline"
              >
                Not now
              </Button>
            </form>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// Things named in a sentence: a, b and c.
function list(parts: React.ReactNode[]): React.ReactNode {
  return parts.flatMap((p, i) => [
    i === 0 ? null : i === parts.length - 1 ? " and " : ", ",
    p,
  ]);
}
