"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Agentation's own toolbar: click anything on the page, say what is wrong,
// and the note reaches the agent through its server on 4747, or the
// clipboard when that is not running. Under the menu bar at the right on
// the desk, where it keeps nothing; in the bottom corner on a page of its
// own, whose actions are at the top.
const Agentation = dynamic(
  () => import("agentation").then((m) => m.Agentation),
  { ssr: false },
);

export function Annotations() {
  // Framed as a window in the room, a page wears no developer's tools of its
  // own: they belong to the room around it.
  const [framed, setFramed] = useState(false);
  useEffect(() => setFramed(window.self !== window.top), []);
  const desk = usePathname() === "/";
  // The toolbar is a development tool: it exists only where its server can.
  if (framed || process.env.NODE_ENV !== "development") return null;
  return (
    <Agentation
      endpoint="http://localhost:4747"
      className={
        desk
          ? "max-sm:top-auto! max-sm:bottom-24! top-[calc(env(safe-area-inset-top)+25px+0.5rem)]! right-3! bottom-auto! left-auto!"
          : "top-auto! right-3! bottom-3! left-auto!"
      }
    />
  );
}
