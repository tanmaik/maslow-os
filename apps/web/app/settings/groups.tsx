import type { Group } from "@maslow/db/groups";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { AddMember } from "./groups/add-member";
import { Row, Rows } from "./row";
import { Said } from "./said";
import { Section } from "./section";
import type { Told } from "./told";

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
  said: Told;
}) {
  return (
    <Section id="groups" title="Groups">
      <Rows>
        {groups.map((g) => {
          const out = members.filter(
            (m) => !g.members.some((x) => x.id === m.id),
          );
          return (
            <Row
              key={g.id}
              label={g.name}
              description={
                g.everyone
                  ? "Every member"
                  : g.description ||
                    (g.members.length === 0
                      ? "Nobody yet"
                      : g.members.map((m) => first(m.name)).join(", "))
              }
            >
              {owner && !g.everyone ? (
                <div className="flex flex-wrap items-center justify-end gap-1.5">
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
                      <button
                        type="submit"
                        aria-label={`Remove ${m.name} from ${g.name}`}
                        className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Badge variant="secondary">
                          {first(m.name)}
                          <span aria-hidden className="text-muted-foreground">
                            ×
                          </span>
                        </Badge>
                      </button>
                    </form>
                  ))}
                  {out.length > 0 && <AddMember group={g.id} members={out} />}
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={<Button variant="destructive" size="xs" />}
                    >
                      Delete group
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {g.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The shares this group held go with it, so whatever was
                          open to its members through it closes. Nothing brings
                          it back.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep</AlertDialogCancel>
                        <form action="/settings/groups" method="post">
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="group" value={g.id} />
                          <AlertDialogAction
                            variant="destructive"
                            type="submit"
                          >
                            Delete group
                          </AlertDialogAction>
                        </form>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ) : (
                <span className="flex flex-wrap justify-end gap-1">
                  {g.everyone ? (
                    <Badge variant="outline">everyone</Badge>
                  ) : (
                    g.members.map((m) => (
                      <Badge key={m.id} variant="secondary">
                        {first(m.name)}
                      </Badge>
                    ))
                  )}
                </span>
              )}
            </Row>
          );
        })}
      </Rows>
      {owner && (
        <form
          action="/settings/groups"
          method="post"
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="intent" value="define" />
          <div className="flex flex-wrap items-start gap-2">
            <Input
              aria-label="New group's name"
              name="name"
              required
              maxLength={80}
              placeholder="New group, e.g. Interns"
              className="w-48"
            />
            <Input
              aria-label="What the group is for"
              name="description"
              maxLength={200}
              placeholder="What it is for"
              className="min-w-40 flex-1"
            />
            <Button type="submit">New group</Button>
          </div>
          <Said {...said} />
        </form>
      )}
    </Section>
  );
}
