import { orgOf } from "@placeholder/db/settings";
import { redirect } from "next/navigation";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { deployment } from "@/lib/deployment";
import { principal } from "@/lib/session";
import { storage } from "@/lib/storage";

// What the last save left to say, by the query it redirected with.
type Notice = {
  org?: "saved" | "name" | "image" | "storage";
  profile?: "saved" | "name" | "image" | "storage";
  member?:
    "removed" | "self" | "last" | "uninvited" | "owner" | "member" | "gone";
  invite?: "sent" | "pending" | "member";
};

const NOTICES: Record<string, string> = {
  "org=saved": "Saved.",
  "org=name": "The org needs a name of up to 80 characters.",
  "org=image": "The logo must be a PNG, JPEG or WebP under 2 MB.",
  "org=storage":
    "Saved the name. Images need object storage, which is not set up yet.",
  "profile=saved": "Saved.",
  "profile=name": "You need a name of up to 80 characters.",
  "profile=image": "The avatar must be a PNG, JPEG or WebP under 2 MB.",
  "profile=storage":
    "Saved the name. Images need object storage, which is not set up yet.",
  "member=removed": "Removed. Their sessions are ended.",
  "member=self": "You can't remove yourself.",
  "member=last": "An org keeps at least one owner.",
  "member=uninvited": "Invitation withdrawn.",
  "member=owner": "They are an owner now.",
  "member=gone": "Nobody by that id or address is in the org.",
  "invite=sent": "Invited. They sign in with that address and they're in.",
  "invite=pending":
    "Already invited. They sign in with that address and they're in.",
  "invite=member": "That address already belongs to someone.",
  "member=member": "They are a member now.",
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

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
  const { org, members, invited } = await orgOf(p);
  const me = members.find((m) => m.id === p.userId)!;
  const owner = p.role === "owner";
  const uploads = deployment.storage.kind !== "none";

  return (
    <main className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Button variant="ghost" size="sm" render={<a href="/" />}>
          Back
        </Button>
      </header>

      {owner && (
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
                    <Input
                      id="logo"
                      name="logo"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                    />
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
                  <p className="text-muted-foreground text-sm">{said("org")}</p>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
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
                  <Input
                    id="avatar"
                    name="avatar"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                  />
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Avatars need object storage, which is not set up yet.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="your-name">Name</Label>
              <Input
                id="your-name"
                name="name"
                defaultValue={me.name}
                required
                maxLength={80}
              />
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
                  <TableCell className="text-right">
                    {m.id === p.userId ? (
                      <Badge variant="secondary">you</Badge>
                    ) : m.role === "owner" ? (
                      <Badge variant="outline">owner</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {owner && m.id !== p.userId && (
                      <form
                        action="/settings/members"
                        method="post"
                        className="flex justify-end gap-1"
                      >
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
        </CardContent>
      </Card>
    </main>
  );
}
