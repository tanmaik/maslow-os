"use client";

import type { BrainType, ShareRequest, Stub } from "@maslow/brain";
import type { Group } from "@maslow/db/groups";
import { RiShareForwardLine } from "@remixicon/react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRef, type ReactNode } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SNAP } from "@/lib/motion";

import { recordHref, typeHref, typeText } from "./format";
import { MAY } from "./sharing";
import { TypeIcon } from "./type-icon";

// What the agent asked to share, each ask as a sentence a person can say
// yes or no to, in a tray at the top of the records.
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
  return (
    <div className="flex flex-col gap-2 px-3 pb-3">
      <h2 className="text-xs font-medium text-muted-foreground">
        Waiting on you
      </h2>
      {asks.map((a) => (
        <motion.div key={a.id} layout transition={SNAP}>
          <Ask id={a.id} back={back}>
            Your agent asks to let{" "}
            <b className="text-foreground">
              {list(
                a.subjects.map((s) =>
                  s.who === "everyone"
                    ? "everyone in the org"
                    : s.who === "public"
                      ? "anyone on the internet"
                      : s.who === "group"
                        ? (groups.find((g) => g.id === s.id)?.name ??
                          "a group no longer here")
                        : (people.get(s.id) ?? "someone no longer here"),
                ),
              )}
            </b>{" "}
            {MAY[a.level]}{" "}
            {list(
              a.items.map((it, i) => {
                if ("record" in it) {
                  return (
                    <Link
                      key={i}
                      href={recordHref(it.record)}
                      className="text-foreground underline"
                    >
                      {records.get(it.record)?.title || "a record"}
                    </Link>
                  );
                }
                if ("port" in it) {
                  return (
                    <Link
                      key={i}
                      href="/settings?pane=computer"
                      className="text-foreground underline"
                    >
                      port {it.port} on your computer
                    </Link>
                  );
                }
                if ("file" in it) {
                  return (
                    <span key={i} className="text-foreground">
                      {it.file} on your computer
                    </span>
                  );
                }
                // A whole type, said so it cannot be read as a person: not
                // "every person" but every record of the type `person`.
                const name = types.find((t) => t.id === it.type)?.name;
                return (
                  <Link
                    key={i}
                    href={typeHref(name)}
                    className="inline-flex items-baseline gap-1 text-foreground underline"
                  >
                    every record of type
                    {name ? (
                      <>
                        {" "}
                        <TypeIcon type={name} className="self-center" />
                        {typeText(name)}
                      </>
                    ) : (
                      " it named"
                    )}
                  </Link>
                );
              }),
            )}
            . {a.reason}
          </Ask>
        </motion.div>
      ))}
    </div>
  );
}

// One ask: the sentence, and Accept or Decline, which post the answer.
function Ask({
  id,
  back,
  children,
}: {
  id: string;
  back: string;
  children: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const intent = useRef<HTMLInputElement>(null);
  const answer = (said: "accept" | "decline") => {
    if (!form.current || !intent.current) return;
    intent.current.value = said;
    form.current.requestSubmit();
  };
  return (
    <>
      <form
        ref={form}
        action="/brain/requests"
        method="post"
        className="hidden"
      >
        <input type="hidden" name="request" value={id} />
        <input type="hidden" name="back" value={back} />
        <input ref={intent} type="hidden" name="intent" value="" />
      </form>
      <Alert>
        <RiShareForwardLine />
        <AlertDescription className="text-pretty">{children}</AlertDescription>
        <div className="col-start-2 mt-2 flex gap-2">
          <Button size="sm" onClick={() => answer("accept")}>
            Accept
          </Button>
          <Button size="sm" variant="outline" onClick={() => answer("decline")}>
            Decline
          </Button>
        </div>
      </Alert>
    </>
  );
}

// Things named in a sentence: a, b and c.
function list(parts: ReactNode[]): ReactNode {
  return parts.flatMap((p, i) => [
    i === 0 ? null : i === parts.length - 1 ? " and " : ", ",
    p,
  ]);
}
