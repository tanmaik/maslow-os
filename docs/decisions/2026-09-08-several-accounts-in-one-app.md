# 2026-09-08 — several accounts in one app

A person has more than one account in the apps they live in: two mailboxes,
a work calendar and a home one. Composio holds any number of accounts in one
app for one user, so a connection is one account, never one app, and
connecting an app twice is two accounts.

## Telling them apart

Composio does not say whose account a connection is: the tokens are redacted
and no app's profile is read on the way in, since reading one would be code
per app. So the name is the person's: the page asks for it the moment an
account connects, and it can be changed on the row at any time. The name is
Composio's alias on the account, unique per person and app there, so nothing
is kept here and the rule that Composio is the record still holds. An
account can go unnamed; a person with one account in an app has no reason
to name it.

## Which one the agent acts in

`apps` lists every account with its id and name. `run` takes an account,
and runs in it; with none given it runs in the only account the app has,
and an app with several refuses until one is named, listing them. Composio
would otherwise pick the most recent, silently, and a mail sent from the
wrong mailbox is not a thing to guess at. Which account fits a task is the
agent's to reason from the names; nothing here decides it for them.

## The page

Accounts sit under their app, with the app's own logo from Composio's
catalog; an app to connect is found as the person types, and before they
type the page shows what most people connect, in Composio's own order of
use. The product still names no app.
