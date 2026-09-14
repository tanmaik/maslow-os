import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";

// What a refusal is carried back in.
export const SAID = "said";

// Where a form may send a person back to: a page of this brain, never an
// address a posted field made up.
export const backTo = (given: FormDataEntryValue | null, fallback: string) => {
  const to = String(given ?? "");
  return to.startsWith("/brain") && !to.startsWith("//") ? to : fallback;
};

// A refused form is answered on the page it was posted from, with what the
// door said in hand; a page of bare text is never an answer to a person.
export function refused(request: Request, to: string, said: string) {
  const url = new URL(to, origin(request));
  // What a door says is a phrase; what a person reads is a sentence.
  url.searchParams.set(SAID, said.charAt(0).toUpperCase() + said.slice(1));
  return NextResponse.redirect(url.toString(), 303);
}
