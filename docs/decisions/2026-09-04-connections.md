# 2026-09-04 — connections

The agent will read the apps a person uses. Composio is the connections
layer: it holds the OAuth apps, the tokens and the refreshing for every app it
reaches, and gives one interface over all of them. We write no per-provider
code and no sync, and nothing in the product names an app; every app Composio
reaches is one a person can connect.

## The account is the membership's

The Composio user is the membership, not the org and not the person's email.
A connection belongs to one person in one org and is seen by nobody else,
owners included. It ends with the membership: records are what a person
wrote and stay with the past member, but a token is live access to their
life, so removal or leaving deletes their accounts at Composio, and a member
brought back connects again. An org deleted takes every member's with it.
Both are owed to the vendor in the same transaction as the rows, paid at once
and by the sweep until they are, the way a machine is.

## Nothing is kept here

Composio is the record, the name a person gives an account included. The settings page asks it what a membership has
connected every time it is shown, so a token that expired shows as expired,
and when Composio does not answer the page says so rather than showing
nothing connected. A table of our own, reconciled against Composio's list by
the hourly sweep as machines are against Fly's, was considered and rejected:
that pattern exists because a lost machine bills forever, and a lost Composio
account bills nobody. The only thing a copy adds is a way to go stale.

## A sign-in is vouched for

A sign-in link can be copied and finished by someone else, which would tie
that person's account to whoever began it. So production's Composio project
holds every finished sign-in until we vouch for who did it: Composio sends
the browser to us with a one-time session, and we redeem it naming the
signed-in membership; a mismatch fails the connection. The verifier is one
public address per project, so laptops and previews cannot have one and
their project takes the browser's word instead, which is fine for seeded
people and our own test sign-ins.

## Whose OAuth apps

Composio's managed ones, as the old repo used throughout. They put Composio's
name on the consent screen and share quota across Composio's customers; that
is a reason to bring our own app when a customer asks for branding or scale,
not before.

## The vendor

A raw client over Composio's REST API, like the Fly client: five calls, no
SDK. The SDK carries an OpenAI client and a websocket library for sessions we
do not use. A deployment without a key has no connections in production and
a fake with three pretend apps everywhere else, whose sign-in is a redirect
straight back, so the smoke connects one with no credentials.

## Not yet

Tools reaching the agent, and the read job that backfills six months of a
connected app into the brain: both wait on the model door and the jobs, and
their shape is chosen when the consumer exists. Writing back to apps.
Triggers and webhooks. Our own OAuth apps.
