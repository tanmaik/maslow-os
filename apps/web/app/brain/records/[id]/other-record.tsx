"use client";

import { useEffect, useState } from "react";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

import { TypeIcon } from "../../type-icon";

export type Candidate = { id: string; type: string; title: string };

// The record at the other end of a link, found by typing. The brain asks for
// the few records that match, so a page costs the same whether the brain
// holds ten records or a hundred thousand.
export function OtherRecord({ not, name }: { not: string; name: string }) {
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<Candidate | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    const stop = new AbortController();
    const wait = setTimeout(
      async () => {
        setAsking(true);
        try {
          const said = await fetch(
            `/brain/search?not=${encodeURIComponent(not)}&q=${encodeURIComponent(typed)}`,
            { signal: stop.signal },
          );
          const { records } = (await said.json()) as { records: Candidate[] };
          setFound(records);
        } catch {
          // A search that was replaced by the next keystroke says nothing.
        } finally {
          if (!stop.signal.aborted) setAsking(false);
        }
      },
      typed ? 150 : 0,
    );
    return () => {
      clearTimeout(wait);
      stop.abort();
    };
  }, [typed, not]);

  return (
    <>
      {/* A link with no other end is not a link: the browser asks for one
          before the form is ever posted. */}
      <input
        type="text"
        name={name}
        value={chosen?.id ?? ""}
        onChange={() => {}}
        required
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      />
      <Combobox
        items={found}
        filter={null}
        value={chosen}
        onValueChange={(v: Candidate | null) => setChosen(v)}
        inputValue={typed}
        onInputValueChange={setTyped}
        itemToStringLabel={(c: Candidate) => c.title || "(untitled)"}
      >
        <ComboboxInput
          placeholder="Search the brain"
          aria-label="The other record"
        />
        <ComboboxContent>
          <ComboboxEmpty>
            {asking ? "Looking…" : "Nothing matches."}
          </ComboboxEmpty>
          <ComboboxList>
            {(c: Candidate) => (
              <ComboboxItem key={c.id} value={c}>
                <TypeIcon type={c.type} />
                {c.title || "(untitled)"}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </>
  );
}
