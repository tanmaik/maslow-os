"use client";

import dynamic from "next/dynamic";

// Agentation's toolbar, loaded only when the pill turns it on: click
// anything on the page, say what is wrong, and the note reaches the agent
// through the sync server on 4747, or the clipboard when that is not
// running. It sits just above the pill.
const Agentation = dynamic(
  () => import("agentation").then((m) => m.Agentation),
  { ssr: false },
);

export function Annotations() {
  return <Agentation endpoint="http://localhost:4747" className="bottom-20!" />;
}
