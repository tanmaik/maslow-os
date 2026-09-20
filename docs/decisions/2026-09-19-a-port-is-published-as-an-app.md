# A port is published as an app

2026-09-19. Tanmai, after a study of ryOS's applets: a port becomes an
app only when the person publishes it; publishing offers the port's own
favicon and name, adjustable right there; a port that is not alive is
not there at all; the dock never again shows every port; a shared app carries its name and icon to
the colleague; widgets keep separate placements on a phone and a laptop.

## The noun

Until tonight a port had no identity of its own: the dock listed every
port the door found, as "Port 3000 · node", with whatever favicon the
door could fetch. The gap ryOS closes with an applet, a file with a name
and a picture, we close with a row: `published_apps`, one per computer
and port, holding the name, the face as a data address, and the place on
its owner's shelf. Publishing is done from the Applets window's list of
ports, beside Share, in a dialog that offers the door's favicon and the
program's name and takes another of either; a picture chosen is shrunk
by the same image input the avatar uses and kept as the face. An app is
renamed and unpublished from the same dialog.

## Where an app is

Only apps are in the dock, the command bar and the widgets' menus, and an
app whose port is not listening this moment is nowhere at all, since the
dock is asked after the ports every two seconds and the list is the
published rows met with the live ones. The dock's run of apps stands in
the order they were added, the same on every device; the built-in blocks
keep the order each device dragged them into. A colleague reached by a share of the port sees
the app under its published name and face, through the same row, which
their read of it is allowed by the share and no more; a shared port never
published stays "Port N · owner's". A colleague's dock is not asked after
the owner's machine every two seconds, so what is shared with them stays
in their dock while the share stands, alive or not; opening one that is
down says so in the window, as it did before.

## Widgets on a phone

A widget carries a second place, `phone`, written when it is moved or
resized on a phone and read there; a laptop reads the first. The two
desktops are not the same shape, and a widget put in a corner of one is
not in a corner of the other.

## A window or a tab

2026-09-20. A page that tells browsers it may not be framed, Maslow's own
dev stack among them, cannot be a window: the browser refuses and the
window says so. The door already reads each port's page once for its
favicon; it notes there whether the page sends `X-Frame-Options` or a
`frame-ancestors` that is not `*`, and says so with the port (`tab`). Such
a port opens in a browser tab from Applets, the dock and the command bar.
The owner may ask for the same of any app, a switch where they add it to
the Dock, kept on its row (`published_apps.tab`), and every row's menu has
"Open in a new tab". A bare port that may be framed opens as a window, as
before.

## Gone means gone, after ten minutes

2026-09-20. Tanmai: a program that stops should leave nothing behind, "it
should just be new", and then, on hearing what a crash or a restart would
cost, "let's do like 10 minutes, but if it auto-recovers it can stay". A
port that matters, one with an app or a share, found not listening is
written down with the time (`stopped_ports`), shown as stopped in
Applets, and nowhere else, as before. Listening again within ten minutes,
the note goes and everything is as it was. Gone longer, the app, every
share and the public address go with the note, the door is told its
public list again, and the port is a new one when it next listens. The
judging rides the owner's own asks after their computer, at most every
fifteen seconds, since that is when the door is asked; a computer nobody
is looking at is judged at its owner's next look.

Only an app is a window. Open on a row in Applets is a browser tab; an
app opens as a window from the dock; and a port that is no app, asked for
with `open :PORT` on the machine, is shown in the computer's own browser
at `localhost`, which needs no ticket. The run of apps in the dock stands
in the order they were added: dragging them into an order, kept on the
server, was built on 2026-09-19 and taken out the next day, with the
bare-port windows of the same week, to keep what an app is small.

A door that could not be told of a public list when it changed says which
one it holds with its numbers, and is told again at the owner's next
look rather than within the hour.
