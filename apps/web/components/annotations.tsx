"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Agentation's own toolbar: click anything on the page, say what is wrong,
// and the note reaches the agent through its server on 4747, or the
// clipboard when that is not running. Bottom right, clear of the dock.
const Agentation = dynamic(
  () => import("agentation").then((m) => m.Agentation),
  { ssr: false },
);

export function Annotations() {
  // Framed as a window in the room, a page wears no developer's tools of its
  // own: they belong to the room around it.
  const [framed, setFramed] = useState(false);
  useEffect(() => setFramed(window.self !== window.top), []);
  if (framed) return null;
  return (
    <Agentation
      endpoint="http://localhost:4747"
      className="top-auto! right-20! bottom-5! left-auto!"
    />
  );
}
