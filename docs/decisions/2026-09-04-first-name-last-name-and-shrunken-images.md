# 2026-09-04 — a first name, maybe a last name, and images shrunk before they are sent

## A person has a first name and, optionally, a last name

Names were one column, and the first thing anyone wanted to do with them was
address someone by their first name. `people` and `users` now carry
`first_name` (required) and `last_name` (nullable). The display name `name`
still exists on both tables, but as a column the database generates from the
two, so everything that reads a name reads it as before and nothing can write
it. An identity provider that offers a split name is taken at its word; one
that offers only a full name is cut at the first space; one that offers
neither gives the address's local part as a first name.

## Images are shrunk in the browser, not refused by the server

A logo or avatar is shown at 64px. The 2 MB cap on uploads was refusing
ordinary phone photos for no gain. The file input now decodes whatever the
browser can, draws it at 512px on its longest side and sends a WebP, or a PNG
where the browser cannot write WebP; the cap stays as the server's guard for
a client with scripting off. The form waits for the shrink if Save is pressed
first.
