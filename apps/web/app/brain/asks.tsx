import type { BrainType, ShareRequest, Stub } from "@maslow/brain";
import type { Group } from "@maslow/db/groups";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { recordHref, typeHref } from "./format";

// What the agent asked to share, each ask as a sentence a person can say
// yes or no to, in a row at the top of the records.
export function Asks({
  asks,
  records,
  types,
  people,
  groups,
  back = "/brain",
}: {
  asks: ShareRequest[];
  records: Map<string, Stub>;
  types: BrainType[];
  people: Map<string, string>;
  groups: Group[];
  // Where an answer lands: the page the ask was answered on.
  back?: "/" | "/brain";
}) {
  if (asks.length === 0) return null;
  const may = {
    view: "see",
    edit: "see and change",
    owner: "do everything with",
  };
  return (
    <div className="space-y-2 px-3.5 pb-3">
      {asks.map((a) => (
        <Card
          key={a.id}
          className="bg-primary/10 ring-primary/35 flex-row flex-wrap items-center gap-0 gap-x-3 gap-y-2 rounded-[10px] px-3 py-2.5 text-sm"
        >
          <p className="min-w-0 flex-1 basis-64">
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
                ) : "port" in it ? (
                  <Link
                    key={i}
                    href="/computer"
                    className="font-medium underline"
                  >
                    port {it.port} on your computer
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
            . <span className="text-muted-foreground">{a.reason}</span>
          </p>
          <form action="/brain/requests" method="post" className="flex gap-1">
            <input type="hidden" name="request" value={a.id} />
            <input type="hidden" name="back" value={back} />
            <Button
              type="submit"
              size="sm"
              name="intent"
              value="accept"
              className="rounded-full"
            >
              Share
            </Button>
            <Button
              type="submit"
              size="sm"
              variant="ghost"
              name="intent"
              value="decline"
              className="rounded-full"
            >
              Not now
            </Button>
          </form>
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
