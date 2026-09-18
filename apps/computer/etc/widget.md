# Making a widget for the desktop

A widget is a small app served on a port of this computer, placed on the
person's desktop with the brain's `place` tool. It lies under their
windows on every device they use, with no title bar, at the size you give
it: one surface made for a glance, not a page.

1. Make the app in a folder of the home, with BoardUI. Call `boardui`
   for the rules and the catalog first. Then:
   `npm create vite@latest ~/widgets/<name> -- --template react-ts`,
   and in that folder `npx boardui@latest init -y` and
   `npx boardui@latest add <the components you need>`.
2. It fills its whole viewport with no margin, chrome or heading of its
   own; the desktop draws the frame. The desktop is dark unless the
   person picked light, and BoardUI's tokens follow.
3. Run it as the person, on a port above 1024, in the background so it
   outlives this turn:
   `cd ~/widgets/<name> && nohup npm run dev -- --host 127.0.0.1 --port 4310 >~/widgets/<name>.log 2>&1 &`
   then `curl -s http://127.0.0.1:4310 | head -3` to see it answers.
4. Look at it before placing it: `navigate` to `http://127.0.0.1:4310`,
   then `screenshot`, and fix what is wrong.
5. Place it with the brain's `place`: the `port`, a `title`, and where it
   lies as shares of the desktop, `x`, `y`, `w`, `h` from 0 to 1. `desktop`
   says what is already there; `unplace` takes one off.
6. It stays until taken off, and the person may move, resize, minimize or
   remove it. Take off what is no longer worth a glance.
