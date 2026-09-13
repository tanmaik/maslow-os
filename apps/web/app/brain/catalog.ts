import { catalog, count, counts, type BrainType } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { cache } from "react";

import { peopleOf } from "./people";

// This person's vocabulary, how many records of their own their brain
// holds, how many each type holds, and the org's people by name, read once
// per request however many parts of the page ask.
export const vocabulary = cache(
  (
    p: Principal,
  ): Promise<{
    types: BrainType[];
    records: number;
    held: Map<string, number>;
    people: Map<string, string>;
  }> =>
    asPerson(p, async (db) => ({
      ...(await catalog(db)),
      records: await count(db),
      held: await counts(db),
      people: await peopleOf(db),
    })),
);
