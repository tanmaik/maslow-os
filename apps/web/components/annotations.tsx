"use client";

import { Agentation } from "agentation";

// Agentation's toolbar: click anything on the page, say what is wrong, and
// the note reaches the agent through the sync server on 4747, or the
// clipboard when that is not running. Rendered only outside production,
// beside the dev toolbar.
export function Annotations() {
  return <Agentation endpoint="http://localhost:4747" />;
}
