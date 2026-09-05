import { groupsOf } from "@placeholder/db/groups";
import { orgOf } from "@placeholder/db/settings";
import { redirect } from "next/navigation";

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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ImageInput } from "@/components/image-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DeleteOrg } from "@/app/settings/delete-org";
import { Groups } from "@/app/settings/groups";
import { deployment } from "@/lib/deployment";
import { initials } from "@/lib/initials";
import { amount, dollars } from "@/lib/meter";
import { principal } from "@/lib/session";
import { usageOfOrg } from "@placeholder/db/usage";
import { storage } from "@/lib/storage";

// What the last save left to say, by the query it redirected with.
type Notice = {
  org?: "saved" | "name" | "image" | "storage";
  leave?: "principal";
  delete?: "mismatch";
  profile?: "saved" | "name" | "image" | "storage";
  member?:
    | "removed"
    | "restored"
    | "purged"
    | "self"
    | "principal"
    | "handed"
    | "uninvited"
    | "owner"
    | "member"
    | "gone";
  invite?: "sent" | "pending" | "member";
  group?: "saved" | "deleted" | "gone";
};

const NOTICES: Record<string, string> = {
  "org=saved": "Saved.",
  "computers=on": "Computers are on. Everyone in the org can open theirs.",
  "computers=off":
    "Computers are off. What exists stays until a member is purged.",
  "org=name": "The org needs a name of up to 80 characters.",
  "org=image":
    "That file can't be the logo. A PNG, JPEG or WebP under 2 MB always works.",
  "org=storage":
    "Saved the name. Images need object storage, which is not set up yet.",
  "delete=mismatch": "Type the org's name exactly to delete it.",
  "leave=principal":
    "You hold the org. Hand it to someone else before you leave, or delete it.",
  "profile=saved": "Saved.",
  "profile=name": "You need a first name. Names are up to 80 characters.",
  "profile=image":
    "That file can't be the avatar. A PNG, JPEG or WebP under 2 MB always works.",
  "profile=storage":
    "Saved the name. Images need object storage, which is not set up yet.",
  "member=removed":
    "Removed. Their sessions are ended, and what they wrote is kept under past members.",
  "member=restored":
    "They're back, with everything they wrote. They sign in and they're in.",
  "member=purged":
    "Purged. Their membership and everything they wrote are gone.",
  "member=self": "You can't remove yourself. Leave from the card above.",
  "member=principal": "The principal owner stays until they hand the org over.",
  "member=handed": "They hold the org now.",
  "member=uninvited": "Invitation withdrawn.",
  "member=owner": "They are an owner now.",
  "member=gone": "Nobody by that id or address is in the org.",
  "invite=sent": "Invited. They sign in with that address and they're in.",
  "invite=pending":
    "Already invited. They sign in with that address and they're in.",
  "invite=member": "That address already belongs to someone.",
  "invite=founders":
    "Outside production, invitations reach founders only; that address would get no mail.",
  "member=member": "They are a member now.",
  "group=saved": "Saved.",
  "group=deleted": "Group deleted, and the shares it held with it.",
  "group=gone": "Nobody by that id is in the org.",
};

// The signed-in person's org and profile, and who is in the org.
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<Notice>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const n = await searchParams;
  const said = (k: keyof Notice) => (n[k] ? NOTICES[`${k}=${n[k]}`] : null);
  const { org, members, invited, past } = await orgOf(p);
  const groups = await groupsOf(p);
  const me = members.find((m) => m.id === p.userId)!;
  const owner = p.role === "owner";
  const holder = p.userId === org.principalId;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const usage = owner ? await usageOfOrg(p, monthStart) : [];
  const total = usage.reduce((n, l) => n + l.cost, 0);
  const uploads = deployment.storage.kind !== "none";

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {owner && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Org</CardTitle>
              <CardDescription>What everyone in it sees.</CardDescription>
            </CardHeader>
            <CardContent>
              <form
                action="/settings/org"
                method="post"
                encType="multipart/form-data"
                className="space-y-4"
              >
                <div className="flex items-center gap-4">
                  <Avatar className="size-16 rounded-md">
                    {org.logoKey && (
                      <AvatarImage src={storage.url(org.logoKey)} alt="" />
                    )}
                    <AvatarFallback className="rounded-md">
                      {initials(org.name)}
                    </AvatarFallback>
                  </Avatar>
                  {uploads ? (
                    <div className="space-y-2">
                      <Label htmlFor="logo">Logo</Label>
                      <ImageInput id="logo" name="logo" />
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      Logos need object storage, which is not set up yet.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-name">Name</Label>
                  <Input
                    id="org-name"
                    name="name"
                    defaultValue={org.name}
                    required
                    maxLength={80}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit">Save</Button>
                  {said("org") && (
                    <p className="text-muted-foreground text-sm">
                      {said("org")}
                    </p>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>
          {deployment.computers.kind !== "none" && (
            <Card>
              <CardHeader>
                <CardTitle>Computers</CardTitle>
                <CardDescription>
                  {org.computers
                    ? "Every member gets a computer: a disk, a machine that wakes when they open it, a terminal, backups. It costs while it exists."
                    : "Off. Nobody in this org has a computer."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form action="/settings/computers" method="post">
                  <input
                    type="hidden"
                    name="on"
                    value={org.computers ? "no" : "yes"}
                  />
                  <Button
                    type="submit"
                    variant={org.computers ? "outline" : "default"}
                    data-computers={org.computers ? "on" : "off"}
                  >
                    {org.computers ? "Turn computers off" : "Turn computers on"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle>You</CardTitle>
          <CardDescription>{me.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            action="/settings/profile"
            method="post"
            encType="multipart/form-data"
            className="space-y-4"
          >
            <div className="flex items-center gap-4">
              <Avatar className="size-16">
                {me.avatarKey && (
                  <AvatarImage src={storage.url(me.avatarKey)} alt="" />
                )}
                <AvatarFallback>{initials(me.name)}</AvatarFallback>
              </Avatar>
              {uploads ? (
                <div className="space-y-2">
                  <Label htmlFor="avatar">Avatar</Label>
                  <ImageInput id="avatar" name="avatar" />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Avatars need object storage, which is not set up yet.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="first-name">First name</Label>
                <Input
                  id="first-name"
                  name="first_name"
                  defaultValue={me.firstName}
                  required
                  maxLength={80}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last-name">Last name</Label>
                <Input
                  id="last-name"
                  name="last_name"
                  defaultValue={me.lastName ?? ""}
                  maxLength={80}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit">Save</Button>
              {said("profile") && (
                <p className="text-muted-foreground text-sm">
                  {said("profile")}
                </p>
              )}
            </div>
          </form>
          {holder ? (
            <p className="text-muted-foreground mt-4 text-sm">
              {said("leave") ??
                "You hold the org. Hand it to someone else before you leave, or delete it below."}
            </p>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="ghost" size="sm" className="mt-4" />}
              >
                Leave {org.name}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Leave {org.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You become a past member. What you wrote stays under your
                    name, seen by nobody, and an owner can bring you back.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Stay</AlertDialogCancel>
                  <form action="/auth/leave" method="post">
                    <AlertDialogAction variant="destructive" type="submit">
                      Leave
                    </AlertDialogAction>
                  </form>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {members.length} in the org
            {invited.length > 0 && `, ${invited.length} invited`}
            {!owner && ". Owners manage the org and its members."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action="/invite" method="post" className="space-y-2">
            <div className="flex gap-2">
              <Input
                name="email"
                type="email"
                required
                placeholder="colleague@example.com"
              />
              <Button type="submit">Invite</Button>
            </div>
            {(said("invite") ?? said("member")) && (
              <p className="text-muted-foreground text-sm">
                {said("invite") ?? said("member")}
              </p>
            )}
            {deployment.mail.kind === "none" && (
              <p className="text-muted-foreground text-sm">
                No mail is configured, so tell them yourself: they sign in with
                this address and they&apos;re in.
              </p>
            )}
          </form>
          <Table>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="w-10">
                    <Avatar className="size-8">
                      {m.avatarKey && (
                        <AvatarImage src={storage.url(m.avatarKey)} alt="" />
                      )}
                      <AvatarFallback>{initials(m.name)}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell>
                    <p className="truncate">{m.name}</p>
                    <p className="text-muted-foreground truncate text-sm">
                      {m.email}
                    </p>
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    {m.id === p.userId && (
                      <Badge variant="secondary">you</Badge>
                    )}
                    {m.id === org.principalId ? (
                      <Badge variant="outline">principal</Badge>
                    ) : (
                      m.role === "owner" && (
                        <Badge variant="outline">owner</Badge>
                      )
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {owner && m.id !== p.userId && m.id !== org.principalId && (
                      <form
                        action="/settings/members"
                        method="post"
                        className="flex justify-end gap-1"
                      >
                        {holder && (
                          <Button
                            variant="ghost"
                            size="sm"
                            type="submit"
                            name="handover"
                            value={m.id}
                          >
                            Hand over
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          type="submit"
                          name={m.role === "owner" ? "demote" : "promote"}
                          value={m.id}
                        >
                          {m.role === "owner" ? "Make member" : "Make owner"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="submit"
                          name="remove"
                          value={m.id}
                        >
                          Remove
                        </Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {invited.map((email) => (
                <TableRow key={email} className="text-muted-foreground">
                  <TableCell className="w-10">
                    <Avatar className="size-8">
                      <AvatarFallback>?</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="truncate">{email}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="outline">invited</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {owner && (
                      <form action="/settings/members" method="post">
                        <input type="hidden" name="uninvite" value={email} />
                        <Button variant="ghost" size="sm" type="submit">
                          Withdraw
                        </Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {owner && past.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger
                render={<Button variant="ghost" size="sm" className="group" />}
              >
                <span className="group-data-panel-open:hidden">
                  Show {past.length} past{" "}
                  {past.length === 1 ? "member" : "members"}
                </span>
                <span className="hidden group-data-panel-open:inline">
                  Hide past members
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent keepMounted>
                <Table>
                  <TableBody>
                    {past.map((m) => (
                      <TableRow key={m.id} className="text-muted-foreground">
                        <TableCell className="w-10">
                          <Avatar className="size-8">
                            {m.avatarKey && (
                              <AvatarImage
                                src={storage.url(m.avatarKey)}
                                alt=""
                              />
                            )}
                            <AvatarFallback>{initials(m.name)}</AvatarFallback>
                          </Avatar>
                        </TableCell>
                        <TableCell>
                          <p className="truncate">{m.name}</p>
                          <p className="truncate text-sm">{m.email}</p>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">
                            left {m.removedAt.toISOString().slice(0, 10)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <form action="/settings/members" method="post">
                              <Button
                                variant="ghost"
                                size="sm"
                                type="submit"
                                name="restore"
                                value={m.id}
                              >
                                Bring back
                              </Button>
                            </form>
                            <AlertDialog>
                              <AlertDialogTrigger
                                render={<Button variant="ghost" size="sm" />}
                              >
                                Purge
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>
                                    Purge {m.name}?
                                  </AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Their membership and everything they wrote
                                    in the brain are deleted, including anything
                                    others may depend on. Nothing brings it
                                    back. Inviting them again starts them fresh.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Keep</AlertDialogCancel>
                                  <form
                                    action="/settings/members"
                                    method="post"
                                  >
                                    <AlertDialogAction
                                      variant="destructive"
                                      type="submit"
                                      name="purge"
                                      value={m.id}
                                    >
                                      Purge
                                    </AlertDialogAction>
                                  </form>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CollapsibleContent>
            </Collapsible>
          )}
        </CardContent>
      </Card>

      {holder && (
        <Card>
          <CardHeader>
            <CardTitle>Delete {org.name}</CardTitle>
            <CardDescription>
              Everything in it goes with it, for everyone in it. Hand the org
              over instead if someone else should keep it.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <DeleteOrg name={org.name} />
            {said("delete") && (
              <p className="text-muted-foreground text-sm">{said("delete")}</p>
            )}
          </CardContent>
        </Card>
      )}
      {owner && (
        <Card>
          <CardHeader>
            <CardTitle>Usage this month</CardTitle>
            <CardDescription>
              What each person is costing, in the vendors&apos; own units, at
              their list prices. Total so far:{" "}
              <span data-usage-total={total}>{dollars(total)}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.map((l) => (
                  <TableRow key={`${l.userId}-${l.resource}`}>
                    <TableCell>{l.name ?? "purged member"}</TableCell>
                    <TableCell>{l.resource}</TableCell>
                    <TableCell>
                      {amount(l.resource, l.unit, l.quantity)}
                    </TableCell>
                    <TableCell>{dollars(l.cost)}</TableCell>
                  </TableRow>
                ))}
                {usage.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      Nothing metered yet this month.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Groups
        groups={groups}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        owner={owner}
        said={said("group")}
      />
    </main>
  );
}
