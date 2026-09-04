# The terminal and previews come from the machine

2026-09-04

The Computer page has a shell on the disk at the bottom, and every port the
machine listens on is a preview a browser can open. Neither passes through
Vercel: the app signs a short-lived link naming the machine, and the browser
talks to the machine through Fly's proxy, replayed to the right machine if it
landed elsewhere.

**The terminal** is a pty on the machine over a WebSocket. Keys go in as
binary frames, the screen comes back, a text frame resizes. The shell runs
with its home on the volume, so dotfiles and logins persist. node-pty is
native code: the image compiles it in a build stage and ships only the
result; a laptop loads its prebuilt binary; the install script is on the
allow-list for that. In the browser the terminal is xterm.js, the one thing
on screen beside shadcn, because a terminal emulator is not a component.

**A preview** is the machine forwarding to one of its own ports. The signed
link sets a cookie naming the machine and the port and sends the browser to
the root of the app's hostname, where everything that is not the daemon's own
is forwarded to that port, WebSockets included. One port per browser at a
time; an app served under its own path is not rewritten. Per-port hostnames
need a wildcard domain and come later.

**What is listed** is read from the machine: `/proc/net/tcp` on Fly, `lsof`
on a laptop, the daemon's own port left out.
