import type { Group } from "@maslow/db/groups";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

import { Item } from "@/components/ui/item";
import { Section } from "./section";

// A person's first name, as a chip lists who is in a group.
const first = (name: string) => name.split(/\s+/)[0] ?? name;

// The org's groups and who is in them. Everyone is every member and cannot
// be changed; owners make the rest.
export function Groups({
  groups,
  members,
  owner,
  said,
}: {
  groups: Group[];
  members: { id: string; name: string }[];
  owner: boolean;
  said: string | null;
}) {
  return (
    <Section
      id="groups"
      title="Groups"
      description={
        <>
          Who a record can be shared with, besides one person at a time.
          {!owner && " Owners manage groups."}
        </>
      }
    >
      <div className="space-y-2">
        {groups.map((g) => (
          <Item variant="muted" className="flex-wrap rounded-[10px]" key={g.id}>
            <span className="text-sm font-medium">{g.name}</span>
            {(!owner || g.everyone || g.members.length === 0) && (
              <span className="text-muted-foreground text-xs">
                {g.everyone
                  ? "every member"
                  : g.members.length === 0
                    ? "nobody yet"
                    : g.members.map((m) => first(m.name)).join(", ")}
              </span>
            )}
            {g.description && (
              <span className="text-muted-foreground text-xs">
                · {g.description}
              </span>
            )}
            <span className="flex-1" />
            {owner && !g.everyone && (
              <>
                {g.members.map((m) => (
                  <form
                    key={m.id}
                    action="/settings/groups"
                    method="post"
                    className="contents"
                  >
                    <input type="hidden" name="intent" value="remove" />
                    <input type="hidden" name="group" value={g.id} />
                    <input type="hidden" name="member" value={m.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="xs"
                      aria-label={`Remove ${m.name} from ${g.name}`}
                      className="text-muted-foreground gap-0.5 px-1.5"
                    >
                      {m.name}
                      <XIcon className="size-3" />
                    </Button>
                  </form>
                ))}
                {members.some((m) => !g.members.some((x) => x.id === m.id)) && (
                  <form
                    action="/settings/groups"
                    method="post"
                    className="flex items-center gap-1"
                  >
                    <input type="hidden" name="intent" value="add" />
                    <input type="hidden" name="group" value={g.id} />
                    <NativeSelect name="member" className="h-7 text-xs">
                      {members
                        .filter((m) => !g.members.some((x) => x.id === m.id))
                        .map((m) => (
                          <NativeSelectOption key={m.id} value={m.id}>
                            {m.name}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                    <Button variant="outline" size="xs" type="submit">
                      Add
                    </Button>
                  </form>
                )}
                <form action="/settings/groups" method="post">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="group" value={g.id} />
                  <Button
                    variant="ghost"
                    size="xs"
                    type="submit"
                    className="text-muted-foreground"
                  >
                    Delete group
                  </Button>
                </form>
              </>
            )}
          </Item>
        ))}
      </div>
      {owner && (
        <form action="/settings/groups" method="post" className="space-y-2">
          <input type="hidden" name="intent" value="define" />
          <div className="flex flex-wrap gap-2">
            <Input
              name="name"
              required
              maxLength={80}
              placeholder="New group, e.g. Interns"
              className="w-48"
            />
            <Input
              name="description"
              maxLength={200}
              placeholder="What it is for"
              className="flex-1"
            />
            <Button type="submit">New group</Button>
          </div>
          {said && <p className="text-muted-foreground text-sm">{said}</p>}
        </form>
      )}
    </Section>
  );
}
