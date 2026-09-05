import type { Grant, Subject, Target } from "@placeholder/brain";
import type { Group } from "@placeholder/db/groups";

import { FormDialog } from "@/components/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

// A subject as a form value and back: "everyone", "group:<id>", "member:<id>".
const value = (s: Subject) =>
  s.kind === "everyone" ? "everyone" : `${s.kind}:${s.id}`;

// Who a record or a kind is shared with, and, for its owner, a way to share
// it with a person, a group or everyone at a level. Sharing a kind shares
// every record of it.
export function Sharing({
  on,
  owner,
  ownerName,
  grants,
  groups,
  members,
}: {
  on: Target;
  owner: boolean;
  ownerName: string;
  grants: Grant[];
  groups: Group[];
  members: { id: string; name: string }[];
}) {
  const what = "kind" in on ? "kind" : "record";
  const target =
    "kind" in on
      ? { name: "kind", value: on.kind }
      : { name: "record", value: on.record };
  const name = (s: Subject) =>
    s.kind === "everyone"
      ? "Everyone"
      : s.kind === "group"
        ? (groups.find((g) => g.id === s.id)?.name ?? "a group no longer here")
        : (members.find((m) => m.id === s.id)?.name ??
          "someone no longer here");
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        Owned by {ownerName}
        {grants.length > 0 && (
          <>
            {" · shared with "}
            {grants.map((g, i) => (
              <span key={g.id}>
                {i > 0 && ", "}
                {name(g.subject)} <Badge variant="outline">{g.level}</Badge>
              </span>
            ))}
          </>
        )}
      </p>
      {owner && (
        <FormDialog
          trigger="Share"
          title={`Share this ${what}`}
          description={
            what === "kind"
              ? "Who may see every record of this kind, change them, or do everything with them. The most any path gives someone is what they can do."
              : "Who may see it, change it, or do everything with it. The most any path gives someone is what they can do."
          }
        >
          <form action="/brain/share" method="post" className="grid gap-3">
            <input type="hidden" name={target.name} value={target.value} />
            <div className="space-y-1">
              <Label htmlFor={`${what}-subject`}>With</Label>
              <Select name="subject" defaultValue="everyone">
                <SelectTrigger id={`${what}-subject`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="everyone">Everyone in the org</SelectItem>
                  {groups
                    .filter((g) => !g.everyone)
                    .map((g) => (
                      <SelectItem key={g.id} value={`group:${g.id}`}>
                        {g.name} (group)
                      </SelectItem>
                    ))}
                  {members.map((m) => (
                    <SelectItem key={m.id} value={`member:${m.id}`}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${what}-level`}>May</Label>
              <Select name="level" defaultValue="view">
                <SelectTrigger id={`${what}-level`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="view">view</SelectItem>
                  <SelectItem value="edit">edit</SelectItem>
                  <SelectItem value="owner">own</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Everyone can only be given view. Editors change; owners also
                share, delete and merge.
              </p>
            </div>
            <div>
              <Button type="submit">Share</Button>
            </div>
          </form>
          {grants.length > 0 && (
            <Table>
              <TableBody>
                {grants.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>{name(g.subject)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{g.level}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <form action="/brain/share" method="post">
                        <input type="hidden" name="intent" value="unshare" />
                        <input
                          type="hidden"
                          name={target.name}
                          value={target.value}
                        />
                        <input
                          type="hidden"
                          name="subject"
                          value={value(g.subject)}
                        />
                        <Button variant="ghost" size="xs" type="submit">
                          Stop sharing
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </FormDialog>
      )}
    </div>
  );
}
