"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { KEPT } from "./kept";

// What the address says about how this list is being looked at, in a fixed
// order so the same view is the same string however it was arrived at.
const stateOf = (params: URLSearchParams) => {
  const state = new URLSearchParams();
  for (const key of KEPT)
    for (const v of params.getAll(key)) state.append(key, v);
  return state.toString();
};

// Keeps how the person is looking at this list, so the next visit opens
// where the last one ended. Nothing is drawn: the address is already the
// truth, and this only writes it down.
export function Remember({ subject }: { subject: string }) {
  const params = useSearchParams();
  const state = stateOf(new URLSearchParams(params.toString()));
  useEffect(() => {
    const body = new FormData();
    body.set("subject", subject);
    body.set("state", state);
    void fetch("/brain/views", { method: "post", body });
  }, [subject, state]);
  return null;
}
