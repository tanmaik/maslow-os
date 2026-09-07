# 2026-09-07 — a click shows the next page at once

## Every link is a Link

Every link in the app was a plain anchor, so a click threw the page away,
waited for the server to render the next one whole, then downloaded and ran
the scripts again. Every link is `next/link` now: a click swaps only the
part of the page that changed, the header and the brain's rail stay where
they are without being read again, and a link on screen is fetched before
it is clicked. A form that writes still posts and reloads.

## A page has a shape before it has rows

`loading.tsx` in the brain and in settings shows the page's shape the
moment a click lands, and the rows stream in behind it. A page behind one
has already started answering when it runs, so a redirect from inside it
reaches the browser as an instruction rather than a status; the layout
above it sends a signed-out visitor to sign in before that point, and the
one page that answers apps, the OAuth consent, has no shape of its own. The
header sits in its own boundary, so a slow lookup of the person's other
orgs holds up nothing else.

## The vocabulary is read once a request

The brain's layout and its pages each read the catalog and the org's people
in a transaction of their own. `vocabulary(p)` in `apps/web/app/brain` is
one read, cached for the request with React's `cache`, however many parts
of the page ask.

## The graph arrives after the table

The records page carried the whole graph inside the page — three hundred
kilobytes of nodes and edges before the first row could be shown. The table
is the page now; the graph is fetched from `/brain/graph` once the table is
on screen, and drawn when it lands.

## The vocabulary page carries one sharing form's worth of markup

Each type's row rendered a full sharing dialog into the page: thirty rows,
thirty forms, over a megabyte. `Sharing` is a client component now, built in
the browser from a few hundred bytes of data per row, and the shares on
every type the person owns are one query rather than one per type.

## A transaction's scope is one round trip

Each scoped transaction sent its reset, its begin and its settings as three
statements. They go as one: statements sent together after a `begin` stay
in that transaction. Values are escaped by the driver, never interpolated
raw. A simple person-scoped read is four round trips, down from six.

## The orgs a person can switch to are one query

The header read each of the person's other orgs in a transaction of its own,
since the org policy showed one org at a time. A sign-in that names an email
now also sees the name of every org that email has a live membership in,
which is what the switch buttons show, and the session carries the email so
nothing has to look it up first.
