import type { Group } from "@maslow/db/groups";
import { XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

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
    <Card>
      <CardHeader>
        <CardTitle>Groups</CardTitle>
        <CardDescription>
          Who a record can be shared with, besides one person at a time.
          {!owner && " Owners manage groups."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {groups.map((g) => (
          <div key={g.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-medium">{g.name}</span>
              {g.everyone && <Badge variant="outline">every member</Badge>}
              {g.description && (
                <span className="text-muted-foreground text-sm">
                  {g.description}
                </span>
              )}
              <span className="flex-1" />
              {owner && !g.everyone && (
                <form action="/settings/groups" method="post">
                  <input type="hidden" name="intent" value="delete" />
                  <input type="hidden" name="group" value={g.id} />
                  <Button variant="ghost" size="sm" type="submit">
                    Delete group
                  </Button>
                </form>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {g.members.map((m) => (
                <Badge key={m.id} variant="secondary" className="gap-1">
                  {m.name}
                  {owner && !g.everyone && (
                    <form action="/settings/groups" method="post">
                      <input type="hidden" name="intent" value="remove" />
                      <input type="hidden" name="group" value={g.id} />
                      <input type="hidden" name="member" value={m.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="xs"
                        aria-label={`Remove ${m.name} from ${g.name}`}
                        className="h-4 px-0.5"
                      >
                        <XIcon className="size-3" />
                      </Button>
                    </form>
                  )}
                </Badge>
              ))}
              {g.members.length === 0 && (
                <span className="text-muted-foreground text-sm">
                  Nobody yet.
                </span>
              )}
              {owner &&
                !g.everyone &&
                members.some((m) => !g.members.some((x) => x.id === m.id)) && (
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
            </div>
          </div>
        ))}
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
              <Button type="submit">Make group</Button>
            </div>
            {said && <p className="text-muted-foreground text-sm">{said}</p>}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
