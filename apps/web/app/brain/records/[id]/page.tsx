import { isId } from "@maslow/brain";
import { notFound, redirect } from "next/navigation";

import { principal } from "@/lib/session";

import { recordPageHref } from "../../format";

import { RecordPane, readRecord } from "./pane";

// The way back, opened on another record where it was opened on one: a
// hop from record to record comes back to the last one read, not the
// first.
const sameListOpenOn = (back: string, id: string) => {
  const u = new URL(back, "http://brain");
  if (!u.searchParams.has("open")) return back;
  u.searchParams.set("open", id);
  return `${u.pathname}${u.search}`;
};

// One record on a page of its own, with the way back to the brain: to
// the list it was opened from, with it still open beside, or to the front.
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string | string[] }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { id } = await params;
  if (!isId(id)) notFound();
  const { back } = await searchParams;
  const from =
    typeof back === "string" && /^\/brain(\?|$)/.test(back) ? back : "/brain";
  const found = await readRecord(p, id);
  if (!found) notFound();
  return (
    <div className="page-sheet flex min-h-full flex-col rounded-3xl border border-border-button-default bg-background-primary-default p-4 sm:p-5">
      <RecordPane
        p={p}
        found={found}
        back={{ href: from, label: "Your brain" }}
        here={recordPageHref(id, from)}
        hrefOf={(id) => recordPageHref(id, sameListOpenOn(from, id))}
      />
    </div>
  );
}
