# 2026-09-17 — the iPhone

Maslow on a phone is a native iPhone app, not the web shell in a browser:
SwiftUI on iOS 26, wearing the system's own Liquid Glass, standard
navigation and standard type, so it feels like the phone and not like a
site. It signs in as the person, with the same code sign-in the lock
screen makes, and shows what is theirs: the brain, what waits on them,
and their computer.

## Why

Tanmai, 2026-09-17: "an iphone app that feels hella native with liquid
glass and super smooth animations, and connects in with your account and
you can see all your shit." The phone shell over the desk's windows is a
desk on a phone; a brain on a phone wants to be read like Notes, Mail
and Messages are read, with the phone's own bars, sheets and springs.

## What it is

- **Native, in `apps/iphone`.** SwiftUI, Swift 6 with the main actor
  as the default, iOS 26 as the floor since Liquid Glass begins there.
  Glass is the system's: tab bar, navigation bar, toolbars and the
  glass button style, never drawn by hand and never on content. The
  project file is written by `xcodegen` from `project.yml` and is not
  committed. The terminal is drawn by SwiftTerm, a Swift package resolved
  from GitHub as Apple's tooling resolves every package: the app builds
  only on a Mac with Xcode, never in a cloud agent's sandbox, so the rule
  that everything arrives from npm, which is about those sandboxes, does
  not reach it.
- **The phone is the person.** Its session is a browser's kind, held as
  a bearer token instead of a cookie: the site's own doors open to it,
  everything it does is logged in the person's name, and the brain's
  MCP refuses it as it refuses a browser. It is not an agent and is not
  listed among them; a lost phone or a forgotten browser is ended from
  Settings › Access with "Sign out the others", which keeps only the
  session asking.
- **One door in, `POST /auth/device`.** An email gets a code; the email
  and the code get a session, who it opens as and the orgs the person is
  in; a membership, with the session, moves it to another org; outside
  production a seeded person gets one without a code. `DELETE` ends it.
  `GET` lists the seeded people, none in production. No computer is
  claimed on a phone sign-in: the machine is made when they sign in on
  a desk.
- **Three read doors for the brain,** thin over `packages/brain`:
  `/brain/types`, the vocabulary with how many records each type holds
  and whose it is; `/brain/read`, a page of records with their opening
  lines, by type, owner, words or cursor; `/brain/get`, one record whole
  with every link and what stands at its other end. `/notifications` and
  `/desktop/about` already answered JSON and now answer the phone, as do
  the computer's own doors: its standing, its numbers, its update, its
  backups, its move and its reset, the ticket each socket opens on, and
  the files and ports it serves.
- **What is on it.** A lock screen: the warm ground, the clock, an
  address, six boxes where the last digit sends, the orgs when there
  are several, and the seeded people under a quiet divider outside
  production. Five tabs, since a phone's tab bar holds five and a sixth
  hides two behind More: Agent, the conversation with hold to talk under
  it, the chats in a picker and what the agent asks answered in the
  thread; Brain, the types with their bars and the shared ones under
  their owners, each opening its records cut into days, each record a
  page with its fields, its markdown and its links, written and edited
  here, with the whole brain by its words in the tab's own search field;
  Computer, where the machine stands and the four ways into it —
  terminal, browser, files and ports — with its update, its numbers,
  its backups and its reset under them; Waiting, the notifications, an
  ask answered where it stands; and You, name, org and a switch between
  orgs, the accent, what Claude Code runs on, sign out.
- **Hold to talk is the app.** The Agent tab's one big button: hold it
  and the phone hears, the words appear in the field as they are heard,
  let go and they go, slide the thumb off and nothing is sent. Speech
  becomes words at Deepgram, as the web's hold to talk does: our server
  mints a one-minute grant and the phone streams its microphone there
  directly, so the sound never passes through us and the phone never
  holds the key. Without the key the button says this copy cannot hear.
- **The agent asks nothing on the phone.** Every conversation opened
  from the phone runs in Bypass, and the composer offers no mode: on a
  phone the person is not there to answer, and Tanmai chose it so on
  2026-09-17. An ask raised from elsewhere still stands in the thread
  and is answered there.
- **Location, always.** With Always allowed, the phone logs where the
  person is for as long as they carry it: a fix every minute while the
  app is open, a fix whenever they move a short way with it closed, and
  the phone wakes the app after a longer move if it was ever stopped.
  Every fix goes straight to their computer's door, on a ticket our
  server mints, into `location.log` there, and never through us or into
  our database. Tanmai asked for lifetime location data on 2026-09-17;
  the phone's own permission is the only switch, and refusing it once
  is never asked about again.
- **Push.** A notification left for the person — a note, an ask, an ask
  to share, a share that landed — reaches their phone while the app is
  closed, through Apple's push service on a key of ours: the phone
  registers the token Apple gave it at `/notifications/phone` and
  forgets it on sign out, the server sends after the door that left the
  notification has answered, the phone shows the title and the first
  line, wears the count of asks still waiting, and opens Waiting when
  tapped. Where the deployment has no key, push is off in the open and
  the phone reads when opened and on pull.
- **What it does not do yet.** A thread streams only while the app is
  open. A slash command, a fork of a
  conversation or a model switch: the protocol offers none. Rename,
  delete or a new folder in Files, and who reaches a port or whom the
  person may name: no door answers. SSH, Apps, Members, Groups, Org and
  Deletion: the web renders them from the page's own reads, and the
  phone needs JSON read doors it does not have. A light look: the app is
  dark whatever the person picked.
