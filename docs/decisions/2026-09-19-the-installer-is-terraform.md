# 2026-09-19 — the installer is Terraform

A customer who hosts Maslow builds it in their own AWS account from one
template in `infra/aws/`, written for Terraform and run unchanged by
OpenTofu. Settled with Tanishk on 2026-09-19, for the customer, whose account is
ordinary AWS rather than GovCloud.

## Why Terraform

It is the tool customers' operators, government contractors among them,
most often already run, and what it builds is read before it is made
(`plan`). It can also set up the customer's Microsoft side, which
sign-in through their Entra will need. Against it: it keeps a record of
what it built that must be kept safe, and its licence is no longer open,
which OpenTofu, the open fork, answers. Changing tools is cheap until a
customer has installed and dear after, so it is settled now.

## What it builds first

- **A network of its own** over two of the region's data centres: public
  subnets for the front door and the app, private ones for the database.
  No NAT gateway, which is paid by the hour whether used or not: the app's
  containers sit in the public subnets, closed to everything but the front
  door.
- **The database**, Postgres 18 on RDS, encrypted, backed up daily and kept
  seven days, reachable only from the app. It is made with an owner that
  migrates; the app's restricted `app` role is made by the app with SQL as
  it first starts, since nothing outside the account reaches the database.
- **The store for files**, one private encrypted bucket, uploads from a
  browser accepted only from Maslow's own address, and a key of the app's
  own that opens this bucket alone.
- **The app's secrets** in Secrets Manager: what the template makes, and
  the outside services' keys the operator enters once and it never
  overwrites.
- **Everything tagged** with what it is and whose.

The record of what was built lives in a private, versioned, encrypted
bucket of the account's own, made once by hand before the first run, and
it holds the generated passwords, as Terraform's record does.

## What stands on it

- **The front door**, one load balancer holding the one certificate, for
  the domain and every name under it, so computers' names are covered when
  they come. The domain's DNS zone is made once per account by hand, as
  the state bucket is, so building and taking down never changes where the
  parent domain points.
- **The app and the relay** as containers on Fargate, ARM for the price,
  each given a public address to reach the web instead of a NAT gateway.
  The containers' firewall lets in the front door alone, so the internet
  reaches them only as it reaches Vercel's today. A customer whose rules
  forbid a public address on a container gets private subnets and a NAT
  gateway as a switch, for about $35 a month.
- **Releases built in the account.** A release is a commit; the account's
  own builder makes its images and keeps the last ten, so the operator
  needs no Docker, and nothing runs until a release is named.
- **The chores on EventBridge**, on Vercel's timetable with the same
  secret. EventBridge waits five seconds for an answer and a chore missed
  is not retried, since the next does its work.
- **The app's certificate trust for RDS**: the image carries Amazon's
  database authority, since the driver checks the database's certificate.

## What it is not

- Not keyless access to the store: the app signs with a key today, and
  reaching the bucket through a role of the app's own is a change to the
  app for later.
