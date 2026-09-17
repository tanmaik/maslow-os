# 2026-09-16 — files are shared

A file on a person's computer is theirs until they share it, with a
person, a group or everyone in the org, at view or edit, and a folder
shared reaches everything under it. What is shared with a person stands
in their Files under the sharer's name and opens as their own would: a
text file in the editor, anything else as the Preview window reads it,
whether or not the owner's machine is up. The owner's disk holds the
file and the bucket holds its copy, which the app keeps the same from the
machine, and a save is a save: the last one written is the file. Settled
with Tanishk on 2026-09-16, and built the same day in one pull request;
what the build changed is said where it changed it.

## Why

Two founders working in Maslow together need to hand each other what
they are making, not only what they know. A record is what a person
concluded; a file is what they are building: a draft, a deck, a repo,
what the agent made on the machine. Records and ports are already shared
in one way, and files were the one thing on the machine that were not.
The shape a person expects is Google Drive's: share a thing or a folder,
pick who and how much, and it shows up on their side under your name,
with a link that opens it for whoever is allowed.

## What it is

- **The same sharing, a third time.** Mine until shared; with a person,
  a group or everyone; at view or edit; the owner stays the owner; the
  most any path gives is what a person may do; no deny rules. One share
  is a row: whose computer, which file, whom, at what level. A folder
  shared reaches everything under it, as a type share reaches every
  record of the type. Ending the share is removing the row, and the
  next request on it is refused. A save is checked as it lands, not as
  the file was opened: one whose share has ended, or whose file the
  owner moved or deleted since, is refused, and the page keeps what was
  written.
- **A shared thing has an id, and keeps it.** Sharing a file or folder
  marks it, on the disk, with an id: an extended attribute, which every
  Linux filesystem carries on a file, invisible to the person and to
  every program, and carried along when the file is moved or renamed.
  The share row, the copy in the bucket and the link all name the id,
  never the path, so the owner may move or rename what they shared and
  the share stands, as Drive's does; delete it, and the share is gone
  for everyone. The door keeps one place per id, and follows it as the
  disk changes. A copy the person makes carries the mark, since copying
  a file copies its attributes, and the mark on a copy means nothing:
  the door knows one place for the id, the original's, and a second
  file wearing it is ignored, so a duplicate behaves as an unshared
  file, as a copy of a Drive file is. The door never strips a mark,
  since a copy and a save look alike to a watcher. A file inside a shared folder needs no mark of
  its own; it is reached from the folder's id by its path under it, and
  moved out of the folder it leaves that share, since the share was on
  the folder.
- **Always there.** A shared file is reachable whether or not its
  owner's machine is up, as a Drive file is. The owner's disk is where
  the file lives and where the owner works on it; the bucket holds a
  copy of every shared thing. A colleague reads the file from the
  owner's machine while it is up, through the app, and from the copy
  while it is not; so a machine stopped, moving or taking an update
  changes nothing for anyone the file was shared with. The app keeps
  the copy current, since a machine never calls our server and in
  development cannot reach a laptop at all: on the share, after every
  save a colleague makes, whenever a read from the machine finds the
  copy behind, and every hour, the app asks the door what changed and
  hands it an address signed for each file, which the door sends the
  file to, as it already sends the home's backups. The copy
  is read and written by the colleague's browser on an address the app
  signs for that one object, as the app already signs its own writes to
  the bucket, so a large file never passes through our server. A shared
  thing has a ceiling of ours on its size, and a share past it is
  refused and says so; a folder's copy is written once the folder goes
  quiet, not once for every file a build touches.
- **A save goes both ways.** At edit, a colleague's save lands on the
  disk at once while the machine is up, and in the copy either way; one
  made while the machine is off waits in the copy, and the app hands
  the door an address to take it from the next time the machine is up.
  The owner's own saves go to the disk, and the app copies them out;
  what the door took down is never sent back up, since the copy already
  holds it. Either way the last save written is the file, on both
  sides. What is not shared is never in
  the bucket except as the daily backup; the mirror is of shared things
  alone, and ends with the share.
- **Shared with me.** Files lists, beside Home and the usual places, one
  entry per colleague who shared with the person, holding what they
  shared and nothing of the rest of that home. Opening one reads the
  copy in the bucket, through the app, and never touches the colleague's
  machine. Whose it is is said on the row, as the brain says whose a
  shared type is.
- **Text is edited, and the last save wins, said before it does.** A
  text file opens in the editor Files has, and saving writes the whole
  file. A page with a file open asks every few seconds whether the copy
  changed and takes the new one in while the person is only reading, so
  a viewer is never more than a moment behind. A save carries the time
  the file was last changed when the page opened it; a file changed
  since is not refused, as a record's is, but said: the page says the
  file changed since it was opened, and the person saves over it or
  takes the newer one. The time is the file's own, and the comparison
  is one line; there is no version to keep. Two people who both save
  anyway write over each other, last one standing, as two people on one
  disk always have; nothing merges. A record's body is live because a
  record is one row everyone reads through the brain; a file is a file.
- **Everything else is read.** A picture, a video, a PDF or an Office
  document opens as the Preview window opens it; an archive or a binary
  is offered to download. At edit, changing one of these is replacing
  it, an upload, the way the person uploads their own.
- **The owner alone moves, renames or deletes.** A colleague at edit
  changes what is inside a file; the file's place and its name are the
  owner's, as in Drive. Replacing a file, by the owner writing it or a
  colleague uploading it, changes what is inside and nothing else: the
  id, the share and the link hold, and the door writes the new bytes to
  wherever the id is now. A program that saves by writing a new file and
  renaming it over the old one, or by moving it aside and making it
  again in the same breath, leaves the mark behind; the door watches the
  folder a shared thing stands in, so it sees the thing go and come as
  it happens: back in its place within a moment, it is the same file,
  marked again; gone longer, the door looks for the file itself where it
  went and follows it, and finding it nowhere, the thing is deleted: the
  share ends the moment anyone next looks, and a file made later with
  the same name is a new, unshared file, as in Drive. A save made
  through Maslow's own windows carries the mark onto the new file
  outright. A colleague at edit on a folder
  may add a file to it, which lands on the owner's disk as the owner's;
  taking one out is the owner's alone.
- **A link opens it.** Every shared file and folder has an address on
  our domain, by its id, the one its owner hands out, which opens for
  whoever is signed in and allowed and is a 404 for anyone else, as a
  port's link is. It says nothing of where the file is in the owner's
  home, and it survives a rename. A link pasted into a record is how a
  record points at what it rests on.
- **The agent asks.** The agent shares nothing; its share tool gains
  `files` beside `records`, `types` and `ports`, and the ask names the
  files or folders, by path as the agent sees them, whom, the level and
  why. The person accepts behind the clock,
  and only accepting makes the rows, in their name. A share landing
  leaves a notification for the person it reached and nothing else moves.
- **The share sheet is the port's.** A file or folder in Files has the
  same sheet a port has: everyone in the org, the groups, the people,
  ticked; at view or edit; the link to copy. One sheet for every shared
  thing. It offers what is under the home and nothing else, and the
  copy never follows a link, so a link inside a shared folder reaches
  nothing outside it.

## What it is not

- Not a copy of files into the brain. The brain is a graph of a mind
  and holds no file; a record points at a file by its link.
- Not a sync between machines, and not a mirror of a home: only what is
  shared has a copy in the bucket, and the copy is the share's, gone
  with it.
- Not a comment level. Drive has one; a filesystem has nothing for it to
  mean. View and edit, and owner, as everywhere else.
- Not editing a PDF or a picture in place. Edit on those is replacing
  them.
- Not a share to someone outside the org. Everyone is a member.
- Not live editing. A shared text file is not a live document in the
  relay; two people in one file see each other's saves, not each
  other's typing. The relay stays the brain's.
- Not a colleague's own copy, a trash or a version history. Drive has
  them; one file, and the owner's, is enough for now.

## Order

1. The rows: `file_shares` shaped as `port_shares` is, with a file's id
   and a level; who may see, give and take them; the doors that read
   them for a person and for a colleague; a migration.
2. The door: the mark on a shared file or folder, where each id is,
   followed by its mark when it moves, every file under it with when
   each changed, each read, written and listed by the id and a path
   under it, a copy sent to addresses signed for it, and a colleague's
   save taken from one; and the app serving the file from the machine
   or its copy to whoever may see it, taking a save from whoever may
   edit, and keeping the copy current. One image.
3. Files: the share sheet on a file or folder, Shared with me, opening a
   colleague's file in the editor or the Preview window from the copy,
   and the link.
4. The share tool's `files`, and the ask that carries them.
