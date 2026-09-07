import { catalog, type BrainType } from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import type { Principal } from "@placeholder/db/auth";
import { cache } from "react";

import { peopleOf } from "./people";

// This person's vocabulary and the org's people by name, read once per
// request however many parts of the page ask.
export const vocabulary = cache(
  (
    p: Principal,
  ): Promise<{
    types: BrainType[];
    verbs: string[];
    people: Map<string, string>;
  }> =>
    asPerson(p, async (db) => ({
      ...(await catalog(db)),
      people: await peopleOf(db),
    })),
);
