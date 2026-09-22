"use client";

import { RiAddLine } from "@remixicon/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
        items={members.map((m) => ({ value: m.id, label: m.name }))}
        value={picked}
        onValueChange={(id) => id !== null && setPicked(id)}
      >
        <SelectTrigger size="sm" aria-label="Who to add">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" type="submit">
        <RiAddLine data-icon="inline-start" />
        Add
      </Button>
    </form>
  );
}
