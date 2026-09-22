import { asPerson } from "@maslow/db";
import { agentsOf, devicesOf } from "@maslow/db/auth";
import { groupsOf } from "@maslow/db/groups";
import { orgOf, type Member } from "@maslow/db/settings";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageInput } from "@/components/image-input";
import { AccentPicker } from "@/app/settings/accent";
import { ComputerPane } from "@/app/settings/computer";
import { LookPicker } from "@/app/settings/look-picker";
import { Wallpaper } from "@/app/settings/wallpaper";
import { papersOf } from "@/lib/wallpapers";
import { AccessPane } from "@/app/settings/access";
import { AppsPane } from "@/app/settings/apps-pane";
import { DeleteOrg } from "@/app/settings/delete-org";
import { Groups } from "@/app/settings/groups";
import { PaneSkeleton } from "@/app/settings/pane-skeleton";
import { Panes, type Pane } from "@/app/settings/panes";
import { Row, Rows } from "@/app/settings/row";
import { Said } from "@/app/settings/said";
import { Section } from "@/app/settings/section";
import type { Told } from "@/app/settings/told";
import { on } from "@/app/settings/when";
import { deployment } from "@/lib/deployment";
import { initials } from "@/lib/initials";
import { principal } from "@/lib/session";
import { storage } from "@/lib/storage";

// Which pane a save comes back to, by the notice it redirected with.
const PANE_OF: Partial<Record<keyof Notice, string>> = {
  profile: "you",
  leave: "you",
  keys: "access",
  org: "org",
  member: "members",
  invite: "members",
  connection: "apps",
  agent: "access",
  devices: "access",
  group: "groups",
  delete: "org",
};

// What the last save left to say, by the query it redirected with.
type Notice = {
  keys?: "saved" | "invalid";
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
  invite?: "sent" | "pending" | "member" | "founders" | "address";
  group?: "saved" | "deleted" | "gone";
  connection?:
    | "connected"
    | "failed"
    | "disconnected"
    | "renamed"
    | "taken"
    | "name"
    | "gone"
    | "unanswered";
  // The account a sign-in just made, to be named.
  account?: string;
  agent?: "disconnected" | "gone";
  devices?: "ended";
};

const NOTICES: Record<string, string> = {
  "devices=ended": "Signed out everywhere else. This browser stays signed in.",
  "org=saved": "Saved.",
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
  "invite=address": "An invitation needs an email address.",
  "invite=founders":
    "Outside production, invitations reach founders only; that address would get no mail.",
  "member=member": "They are a member now.",
  "group=saved": "Saved.",
  "group=deleted": "Group deleted, and the shares it held with it.",
  "group=gone": "Nobody by that id is in the org.",
  "connection=connected": "Connected.",
  "connection=failed": "That sign-in didn't finish. Try again.",
  "connection=disconnected": "Disconnected.",
  "connection=renamed": "Named.",
  "connection=taken": "Another account in that app already has that name.",
  "connection=name": "A name is up to 40 characters on one line.",
  "connection=gone": "No such app or connection.",
  "connection=unanswered":
    "Composio refused or didn't answer, so nothing changed. Try again in a moment.",
  "keys=removed": "Removed, and taken off your computer.",
  "keys=unreached":
    "Removed here, but your computer did not answer; it still accepts that key until it next starts.",
  "agent=disconnected": "Disconnected. Its token no longer works.",
  "agent=gone": "That agent was already disconnected.",
};

// The notices that are refusals: a save that did not happen, said in red
// with the warning mark. Everything else is a plain line.
const WRONG = new Set([
  "org=name",
  "org=image",
  "delete=mismatch",
  "leave=principal",
  "profile=name",
  "profile=image",
  "member=self",
  "member=principal",
  "member=gone",
  "invite=member",
  "invite=pending",
  "invite=founders",
  "group=gone",
  "connection=failed",
  "connection=taken",
  "connection=name",
  "connection=gone",
  "connection=unanswered",
  "agent=gone",
  "keys=unreached",
]);

// A supporting line under a form.
const Note = ({ children }: { children: ReactNode }) => (
  <p className="text-xs text-muted-foreground">{children}</p>
);

// A person's picture, or their initials.
function Picture({
  person,
  size = "default",
  className,
}: {
  person: Pick<Member, "name" | "avatarKey">;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  return (
    <Avatar size={size} className={className}>
      {person.avatarKey && <AvatarImage src={storage.url(person.avatarKey)} />}
      <AvatarFallback>{initials(person.name)}</AvatarFallback>
    </Avatar>
  );
}

// The signed-in person's settings, then the org's: who they are, their
// apps, agents and keys; the org, who is in it, its groups.
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<Notice & { pane?: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const n = await searchParams;
  const said = (k: keyof Notice): Told => {
    const key = n[k] ? `${k}=${n[k]}` : null;
    return {
      text: key ? (NOTICES[key] ?? null) : null,
      tone: key && WRONG.has(key) ? "wrong" : "notice",
    };
  };
  // The pane asked for, or the one a save just came back to; the grid
  // when neither. Only that pane's rows are read: the grid, and every
  // other pane, owe nothing to the vendor or the machine.
  const came = (Object.keys(n) as (keyof Notice)[]).find((k) => k in PANE_OF);
  const view = n.pane ?? (came && PANE_OF[came]) ?? "you";
  const [{ org, members, invited, past }, groups, agents, devices, papers] =
    await Promise.all([
      orgOf(p),
      view === "groups" ? groupsOf(p) : [],
      view === "access" ? agentsOf(p) : [],
      view === "access" ? devicesOf(p) : 0,
      view === "look" ? asPerson(p, papersOf) : null,
    ]);
  const me = members.find((m) => m.id === p.userId)!;
  const owner = p.role === "owner";
  const holder = p.userId === org.principalId;
  const uploads = deployment.storage.kind !== "none";
  const panes: Pane[] = [
    {
      id: "you",
      title: "You",
      group: "Yours",
      words: ["name", "avatar", "picture", "email", "leave"],
    },
    {
      id: "look",
      title: "Look",
      group: "Yours",
      words: ["theme", "dark", "light", "accent", "colour", "color", "dock"],
    },
    {
      id: "computer",
      title: "Computer",
      group: "Yours",
      words: [
        "ssh",
        "key",
        "size",
        "region",
        "move",
        "backup",
        "port",
        "reset",
        "claude code",
        "terminal",
      ],
    },
    {
      id: "apps",
      title: "Apps",
      group: "Yours",
      words: ["connect", "connected", "account", "gmail", "calendar"],
    },
    {
      id: "access",
      title: "Access",
      group: "Yours",
      words: [
        "ssh",
        "key",
        "port",
        "share",
        "mcp",
        "session",
        "brain",
        "agents",
      ],
    },
    ...(owner
      ? [
          {
            id: "org",
            title: "Org",
            group: org.name,
            words: ["logo", "name", "delete", "close"],
          },
        ]
      : []),
    {
      id: "members",
      title: "Members",
      group: org.name,
      words: ["invite", "owner", "people", "past"],
    },
    {
      id: "groups",
      title: "Groups",
      group: org.name,
      words: ["sharing", "everyone"],
    },
  ];
  const pane = panes.find((x) => x.id === view) ?? panes[0]!;
  const role = (m: Member) =>
    m.id === org.principalId
      ? "principal"
      : m.role === "owner"
        ? "owner"
        : "member";

  // Each pane's card, drawn only for the pane in view.
  const panels: Record<string, ReactNode> = {
    you: (
      <Section id="you" title="You">
        <form
          action="/settings/profile"
          method="post"
          encType="multipart/form-data"
          className="flex flex-col gap-4"
        >
          <div className="flex items-center gap-4">
            {uploads ? (
              <ImageInput
                id="avatar"
                name="avatar"
                src={me.avatarKey ? storage.url(me.avatarKey) : null}
                fallback={initials(me.name)}
              />
            ) : (
              <Picture person={me} size="lg" className="size-16 *:text-lg" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-lg font-medium text-foreground">
                {me.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {me.email} · {holder ? `principal of ${org.name}` : role(me)}
              </p>
            </div>
          </div>
          <Rows>
            <Row label="First name">
              <Input
                aria-label="First name"
                name="first_name"
                defaultValue={me.firstName}
                required
                maxLength={80}
                className="w-52"
              />
            </Row>
            <Row label="Last name">
              <Input
                aria-label="Last name"
                name="last_name"
                defaultValue={me.lastName ?? ""}
                maxLength={80}
                className="w-52"
              />
            </Row>
          </Rows>
          {!uploads && (
            <Note>Avatars need object storage, which is not set up yet.</Note>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Said {...said("profile")} />
            </div>
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
        {holder ? (
          said("leave").text && <Note>{said("leave").text}</Note>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="link"
                  size="sm"
                  className="self-start px-0 text-muted-foreground"
                />
              }
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
      </Section>
    ),
    computer: (
      <Section id="computer" title="Computer">
        <ComputerPane p={p} />
      </Section>
    ),
    look: (
      <Section id="look" title="Look">
        <Rows>
          <Row label="Look">
            <LookPicker />
          </Row>
          <Row label="Accent">
            <AccentPicker />
          </Row>
        </Rows>
        <Wallpaper papers={papers} />
      </Section>
    ),
    apps: (
      <AppsPane p={p} focus={n.account ?? null} said={said("connection")} />
    ),
    access: (
      <AccessPane
        p={p}
        agents={agents}
        devices={devices}
        saidKeys={said("keys")}
        saidAgent={said("agent")}
        saidDevices={said("devices")}
      />
    ),
    org: (
      <Section id="org" title="Org">
        <form
          action="/settings/org"
          method="post"
          encType="multipart/form-data"
          className="flex flex-col gap-4"
        >
          {uploads ? (
            <ImageInput
              id="logo"
              name="logo"
              src={org.logoKey ? storage.url(org.logoKey) : null}
              fallback={initials(org.name)}
              className="rounded-lg"
            />
          ) : (
            <Avatar className="size-16 rounded-lg *:rounded-[inherit] after:rounded-[inherit]">
              {org.logoKey && <AvatarImage src={storage.url(org.logoKey)} />}
              <AvatarFallback className="text-lg">
                {initials(org.name)}
              </AvatarFallback>
            </Avatar>
          )}
          <Rows>
            <Row label="Name">
              <Input
                aria-label="Name"
                name="name"
                defaultValue={org.name}
                required
                maxLength={80}
                className="w-52"
              />
            </Row>
          </Rows>
          {!uploads && (
            <Note>Logos need object storage, which is not set up yet.</Note>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Said {...said("org")} />
            </div>
            <Button type="submit" size="sm">
              Save
            </Button>
          </div>
        </form>
        {holder && (
          <div className="flex items-center gap-3 border-t border-border pt-4">
            <DeleteOrg name={org.name} />
            <Said {...said("delete")} />
          </div>
        )}
      </Section>
    ),
    members: (
      <Section
        id="members"
        title={`${members.length} ${members.length === 1 ? "member" : "members"}`}
      >
        <form action="/invite" method="post" className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <Input
              aria-label="Email address to invite"
              name="email"
              type="email"
              required
              placeholder="colleague@example.com"
              className="max-w-xs"
            />
            <Button type="submit">Invite</Button>
          </div>
          <Said {...(said("invite").text ? said("invite") : said("member"))} />
          {deployment.mail.kind === "none" && (
            <Note>
              No mail is configured, so tell them yourself: they sign in with
              this address and they&apos;re in.
            </Note>
          )}
        </form>
        <Rows>
          {members.map((m) => (
            <Row
              key={m.id}
              label={
                <span className="flex items-center gap-2.5">
                  <Picture person={m} size="sm" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {m.name}
                      {m.id === p.userId && (
                        <span className="text-muted-foreground"> · you</span>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {m.email}
                    </span>
                  </span>
                </span>
              }
            >
              <Badge
                variant={role(m) === "principal" ? "secondary" : "outline"}
              >
                {role(m)}
              </Badge>
              {owner && m.id !== p.userId && m.id !== org.principalId && (
                <>
                  <span
                    aria-hidden
                    className="hidden h-5 w-px shrink-0 bg-border sm:block"
                  />
                  <form
                    action="/settings/members"
                    method="post"
                    className="flex items-center gap-1.5"
                  >
                    {holder && (
                      <Button
                        variant="outline"
                        size="xs"
                        type="submit"
                        name="handover"
                        value={m.id}
                      >
                        Hand over
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="xs"
                      type="submit"
                      name={m.role === "owner" ? "demote" : "promote"}
                      value={m.id}
                    >
                      {m.role === "owner" ? "Make member" : "Make owner"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="xs"
                      type="submit"
                      name="remove"
                      value={m.id}
                    >
                      Remove
                    </Button>
                  </form>
                </>
              )}
            </Row>
          ))}
          {invited.map((email) => (
            <Row
              key={email}
              label={
                <span className="flex items-center gap-2.5">
                  <Avatar size="sm">
                    <AvatarFallback>?</AvatarFallback>
                  </Avatar>
                  <span className="truncate text-sm text-muted-foreground">
                    {email}
                  </span>
                </span>
              }
            >
              <Badge variant="outline">invited</Badge>
              {owner && (
                <>
                  <span
                    aria-hidden
                    className="hidden h-5 w-px shrink-0 bg-border sm:block"
                  />
                  <form action="/settings/members" method="post">
                    <input type="hidden" name="uninvite" value={email} />
                    <Button variant="outline" size="xs" type="submit">
                      Withdraw
                    </Button>
                  </form>
                </>
              )}
            </Row>
          ))}
        </Rows>
        {owner && past.length > 0 && (
          <Collapsible className="flex flex-col gap-2">
            <CollapsibleTrigger
              render={
                <Button
                  variant="link"
                  size="sm"
                  className="group self-start px-0 text-muted-foreground"
                />
              }
            >
              <span className="group-data-panel-open:hidden">
                {past.length} past {past.length === 1 ? "member" : "members"},
                kept with what they wrote
              </span>
              <span className="hidden group-data-panel-open:inline">
                Hide past members
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted>
              <Rows>
                {past.map((m) => (
                  <Row
                    key={m.id}
                    label={
                      <span className="flex items-center gap-2.5 opacity-70">
                        <Picture person={m} size="sm" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium text-foreground">
                            {m.name}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {m.email} · left {on(m.removedAt)}
                          </span>
                        </span>
                      </span>
                    }
                  >
                    <form action="/settings/members" method="post">
                      <Button
                        variant="outline"
                        size="xs"
                        type="submit"
                        name="restore"
                        value={m.id}
                      >
                        Bring back
                      </Button>
                    </form>
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={<Button variant="destructive" size="xs" />}
                      >
                        Purge
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Purge {m.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Their membership and everything they wrote in the
                            brain are deleted, including anything others may
                            depend on. Nothing brings it back. Inviting them
                            again starts them fresh.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep</AlertDialogCancel>
                          <form action="/settings/members" method="post">
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
                  </Row>
                ))}
              </Rows>
            </CollapsibleContent>
          </Collapsible>
        )}
      </Section>
    ),
    groups: (
      <Groups
        groups={groups}
        members={members.map((m) => ({ id: m.id, name: m.name }))}
        owner={owner}
        said={said("group")}
      />
    ),
  };
  return (
    <main>
      <h1 className="sr-only">Settings</h1>
      <Panes panes={panes} pane={pane}>
        <Suspense key={pane.id} fallback={<PaneSkeleton />}>
          {panels[pane.id]}
        </Suspense>
      </Panes>
    </main>
  );
}
