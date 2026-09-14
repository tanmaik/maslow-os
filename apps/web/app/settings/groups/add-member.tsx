"use client";

import { RiAddLine } from "@remixicon/react";
import { useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { Select, SelectItem } from "@/components/base/select/select";

// Puts one more person in a group: a pick among those not yet in it, and
// Add.
export function AddMember({
  group,
  members,
}: {
  group: string;
  members: { id: string; name: string }[];
}) {
  const [picked, setPicked] = useState(members[0]!.id);
  return (
    <form
      action="/settings/groups"
      method="post"
      className="flex items-center gap-1.5"
    >
      <input type="hidden" name="intent" value="add" />
      <input type="hidden" name="group" value={group} />
      <input type="hidden" name="member" value={picked} />
      <Select
        aria-label="Who to add"
        size="sm"
        selectedKey={picked}
        onSelectionChange={(k) => k !== null && setPicked(String(k))}
        triggerClassName="h-7"
      >
        {members.map((m) => (
          <SelectItem key={m.id} id={m.id}>
            {m.name}
          </SelectItem>
        ))}
      </Select>
      <Button
        variant="secondary"
        size="xs"
        type="submit"
        leadingIcon={RiAddLine}
      >
        Add
      </Button>
    </form>
  );
}
