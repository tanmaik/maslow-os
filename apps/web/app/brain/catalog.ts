import { catalog, type BrainType } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { cache } from "react";

import { peopleOf } from "./people";

// This person's vocabulary and the org's people by name, read once per
// request however many parts of the page ask.
export const vocabulary = cache(
  (
    p: Principal,
  ): Promise<{
    types: BrainType[];
    people: Map<string, string>;
  }> =>
    asPerson(p, async (db) => ({
      ...(await catalog(db)),
      people: await peopleOf(db),
    })),
);
