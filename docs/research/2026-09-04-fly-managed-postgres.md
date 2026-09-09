# Should Maslow move from Neon to Fly Managed Postgres (MPG)?

Researched 2026-09-04 against primary sources only: fly.io/docs/mpg/*,
fly.io/mpg, fly.io/docs/about/pricing, Fly staff posts on community.fly.io,
the fly-apps/fly-mpg-proxy README, neon.com/pricing and Neon docs, and the
local `fly` CLI (v0.4.99, 2026-09-03 build) help text. Anything not backed by
one of those is marked **unverified**.

## TL;DR

**Don't move.** Not now, and the trigger for "later" is concrete (below).

The single decisive fact: **MPG is reachable only from inside your Fly
organization's private network.** Fly's own FAQ: "Is a Fly.io Managed Postgres
cluster reachable from the public internet? No. Your cluster runs inside your
Fly.io organization's private network, so apps in the same organization reach
it directly and nothing else can." ([fly.io/mpg](https://fly.io/mpg/)). Our
app runs on Vercel. The only way Fly offers to bridge that is
[fly-apps/fly-mpg-proxy](https://github.com/fly-apps/fly-mpg-proxy), a
community-grade app whose README says it "is not a part of the Managed
Postgres service and is not supported by fly.io" and which, in its default
configuration, means "anyone on the Internet could connect to the Managed
Postgres instance and try to guess the username and password."

Three further facts each independently argue against moving today:

1. **Previews get worse, not better.** Forking exists only on MPG v2, which is
   in beta in `dfw` and `yyz` only, is dashboard-only ("not available in
   flyctl yet"), and produces a whole new billed cluster (min $38/mo
   prorated). Per-PR databases on one shared cluster are possible
   (`fly mpg databases create`) but there is **no `fly mpg databases delete`**
   — the CLI has only `create`, `extensions`, `list`.
2. **Roles cannot be made with SQL.** `CREATE ROLE` returns "permission denied
   to create role (SQLSTATE 42501)"; Fly staff: "I don't believe the Role
   system lets you create new roles/users through the postgres connection, but
   only through the dashboard." Our field guide's rule ("roles are created with
   SQL, never through the API") cannot be followed; whether Fly's `writer`
   role carries `BYPASSRLS` is **unverified** and would need a tripwire test.
3. **It costs more for less.** MPG's floor is a Basic cluster at $38 + $2.80
   for the mandatory 10 GB ≈ **$41/mo**, plus ~$4–5/mo for a proxy Machine
   and dedicated IPv4, for one region-local HA pair you cannot shrink. The
   same workload on Neon Launch is roughly **$25–35/mo** with "no monthly
   minimum", and might fit Neon Free. Consolidating a ~$30 invoice into Fly's
   does not pay for the loss of Vercel-native connectivity, instant
   branching, PG 18 (MPG supports 16 and 17 only), and SQL-made roles.

Also worth noting: Fly's own overview still lists "Security patches and
version upgrades" as "under development."

**Move later when ALL of these are true:** (a) the app itself runs on Fly
Machines, or Fly ships a supported, TLS-enforced public endpoint with IP
allowlisting; (b) MPG v2 is GA in `iad` (our Vercel/Neon region is us-east)
with forking and database deletion in flyctl; (c) a tripwire test shows the
`writer` role is not `BYPASSRLS` and forced RLS holds through PgBouncer in
transaction mode; (d) MPG offers Postgres 18 or we accept a downgrade.

---

## 1. Connecting from outside Fly's private network (Vercel)

**Answer: No, not natively.** There is no public hostname, no TLS-terminated
public endpoint, and no IP allowlist on the MPG service itself.

- "Because your MPG Cluster runs within your Fly.io private network, it's not
  accessible over the public internet. You can use flyctl to securely connect
  to your database from your local machine ... All connections using flyctl
  are securely routed through your organizations private wireguard network."
  — [docs/mpg/create-and-connect](https://fly.io/docs/mpg/create-and-connect/)
- FAQ quoted in the TL;DR — [fly.io/mpg](https://fly.io/mpg/).
- Hostnames are private: `pgbouncer.<CLUSTER>.flympg.net` (pooled) and
  `direct.<CLUSTER>.flympg.net`; `fly mpg proxy` resolves to a 6PN address
  (`Proxying localhost:16380 to remote [fdaa:1:2345:0:0::11]:5432`). "SSL is
  enabled by default on all MPG connections. You do not need to set `sslmode`."
  — [docs/mpg/client-configuration](https://fly.io/docs/mpg/client-configuration/)
- Local CLI confirms the two private paths: `fly mpg proxy` ("Proxy to a MPG
  database", binds 127.0.0.1:16380) and `fly mpg connect` (psql). Output of
  `fly mpg proxy --help` / `fly mpg connect --help`, 2026-09-04.
- Fly staff, asked about external CI/CD connections: use `fly mpg proxy`
  locally, or better, keep the work inside Fly with a `release_command`
  ephemeral Machine —
  [community 25477](https://community.fly.io/t/connecting-to-managed-postgres-externally/25477).

**What a Vercel-hosted app would have to do.** Fly's answer is
[Fly MPG Proxy](https://community.fly.io/t/mpg-proxy-connect-to-mpg-from-the-internet/25932)
(Kate, Fly staff, 2025-09-14: "If you've wanted to use MPG from the Internet
or other service providers outside of your Org's Private Network, you can now
install an app for that!"). From the
[README](https://github.com/fly-apps/fly-mpg-proxy):

- It is a Fly app you deploy yourself: `fly launch --from=https://github.com/fly-apps/fly-mpg-proxy --secret CLUSTER_ID=...`, answering "Y" to "allocate dedicated ipv4 and ipv6 addresses".
- It exposes "PGDirect on port 5432" and "PGBouncer on port 6432" on a public `*.fly.dev` hostname; you swap that hostname into the cluster's connection URL.
- Security is an `ip-whitelist.txt` that ships as `0.0.0.0/0` and `::0/0`; "In this default configuration, anyone on the Internet could connect to the Managed Postgres instance and try to guess the username and password."
- TLS: the README's own psql transcript shows `SSL connection (protocol: TLSv1.3 ...)` on port 6432, and **no SSL line on port 5432** — so the direct port through the proxy appears to be plaintext in that transcript. Whether TLS can be forced on 5432 through the proxy is **unverified**.
- "It is not a part of the Managed Postgres service and is not supported by fly.io."
- Cost (from [pricing](https://fly.io/docs/about/pricing/)): dedicated IPv4 "$2/mo"; smallest Machine `shared-cpu-1x` 256 MB $1.94–$2.43/mo depending on region. One Machine is a single point of failure for every production query; two doubles it.

Vercel serverless functions do not have fixed egress IPs on standard plans, so
the allowlist would have to stay open — **unverified from a Vercel primary
source in this research; treat as a claim to check before relying on it.**
Every query would also cross Vercel → Fly on the public internet; latency
**unverified**.

The other option is moving `apps/web` off Vercel onto Fly Machines, which is
a different decision entirely (Next.js hosting, preview deployments, the
`ignoreCommand` preview gate) and is out of scope here.

## 2. Forking, branching, restore, many databases per cluster

**Forking/branching:** exists, but only on MPG v2, in beta, dashboard-only.

- "You can now fork your Managed Postgres v2 clusters. Forking is almost as
  fast as v2 cluster creates (well almost, its a tiny bit slower). Its MUCH
  faster than a full backup restore." Caveats: "Your backup history doesn't
  carry over to the fork"; "Large clusters may take a bit of time to hydrate";
  "Its not available in flyctl yet (but will be, soon, hang tight!)"; "And
  well, its still in beta" — akshit-fly, 2026-07-16,
  [community 28292](https://community.fly.io/t/mpgv2-has-forking-in-beta/28292).
- MPG v2 itself: beta, "only available in dfw" (2026-05-19,
  [community 27909](https://community.fly.io/t/managed-postgres-v2-is-now-in-beta/27909)),
  then "available in yyz as well" (2026-06-09,
  [community 28057](https://community.fly.io/t/managed-postgres-v2-beta-now-in-yyz/28057)).
  No `iad`. Cluster-creation time is not quantified anywhere ("wait a few
  moments" — create-and-connect doc); **unverified**.
- A fork is a cluster, so it is billed as one. "Clusters created or deleted
  mid-month will have their pricing prorated accordingly"
  ([docs/mpg#pricing](https://fly.io/docs/mpg/)). Basic = $38/mo ≈ $0.053/h.

**`fly mpg restore`:** always into a NEW cluster, billed separately.

- `fly mpg restore --help` (local, 2026-09-04): "Restore a Managed Postgres
  cluster from a backup or a point in time into a new cluster, leaving the
  source cluster unchanged. The restored cluster is provisioned asynchronously
  in the same organization and billed separately." Flags `--backup-id`,
  `--pitr-time` (RFC3339; "Requires the cluster's PITR recovery window to
  cover this time"), `--name`.
- "PITR restore is available for v2 clusters only. The CLI returns a clear
  error if you try it on v1." "A restore always creates a new cluster, billed
  separately." — tripledoublev, 2026-08-10,
  [community 28464](https://community.fly.io/t/fly-mpg-restore-now-supports-naming-and-point-in-time-restore/28464).
- Backups: "We back your cluster up automatically on a rolling schedule and
  keep those backups for ten days." ([fly.io/mpg](https://fly.io/mpg/)).
  `fly mpg backup list` defaults to "last 24 hours" (`--all` for more). The
  PITR window length is **unverified** (not stated in any doc found).
- Restore duration: forking is described as "MUCH faster than a full backup
  restore"; absolute times **unverified**.

**Many databases on one cluster: yes.** "Multiple databases and schemas on
that cluster" ([docs/mpg](https://fly.io/docs/mpg/)); "Your Managed Postgres
cluster is created with the default `fly-db` database. You can create
additional databases from the dashboard or through `flyctl`"
([docs/mpg/cluster-configuration](https://fly.io/docs/mpg/cluster-configuration/)).
`fly mpg databases create <CLUSTER_ID> -n <name>` (local help). Announced
2025-11-11 by akshit-fly,
[community 26427](https://community.fly.io/t/flyctl-can-now-manage-mpg-users-and-databases/26427).

But, for a per-PR scheme:

- **`CREATE DATABASE` via SQL is not allowed.** Schema Admin "cannot: Create
  new databases. This can be done from your Dashboard"
  ([cluster-configuration](https://fly.io/docs/mpg/cluster-configuration/)).
  So creation goes through flyctl or the dashboard; whether a documented
  public HTTP API exists for it is **unverified** (flyctl clearly calls one,
  but none is documented under docs/mpg).
- **No delete.** `fly mpg databases --help` lists only `create`, `extensions`,
  `list`. Whether Schema Admin can `DROP DATABASE` over SQL is **unverified**
  (a user reported the same gap for their automation, unanswered:
  [community 26213](https://community.fly.io/t/mpg-administration-options/26213)).
  Without it, ten preview databases a day accumulate on the production
  cluster.
- **Per-database extensions need a dashboard click.** Extensions "are
  enabled/disabled per database, not cluster-wide" via the dashboard toggle
  ([docs/mpg/extensions](https://fly.io/docs/mpg/extensions/)). A user
  creating review-app databases in CI hit "permission denied to create
  extension 'postgis' / Must be superuser"; Fly staff (Sam-Fly, 2026-06-19)
  confirmed and said "At a minimum I expect we should be able to expose the
  CREATE EXTENSION on the db level via flyctl" — not shipped as of the thread
  ([community 28124](https://community.fly.io/t/mpg-superuser-permissions-for-extensions/28124)).
  Our migrations currently use no third-party extension, so this bites only
  if `pgvector` ever enters the brain schema.
- **All previews share one connection budget.** Fly staff (kyle,
  2025-12-18): "your cluster can accept up to 200 client connections from your
  apps, and will open up to 50 connections to Postgres ... Postgres allows
  100"
  ([community 26655](https://community.fly.io/t/confusion-about-mpg-connection-limits/26655)).
  A Starter-plan user: "The cluster has a hard limit of 100 connections,
  which seems to apply to the entire cluster, not per database ... once
  database connections exceed ~100, the entire cluster stops responding"
  ([community 27103](https://community.fly.io/t/fly-managed-postgres-and-database-connection-limit-using-the-pg-bouncer/27103)).
  Serverless functions on ten previews plus production would all draw from
  that pool.

Compare Neon, where a branch is "a copy-on-write clone of your data" created
"instantly" with "zero load or performance impact" on the parent
([neon.com/docs/introduction/branching](https://neon.com/docs/introduction/branching)),
gets its own compute, and is deleted with one API call — which is what
`scripts/preview-db.mjs` does today.

## 3. Plans and prices

**MPG** ([docs/mpg#pricing](https://fly.io/docs/mpg/), verified verbatim
2026-09-04; hardware from
[create-and-connect](https://fly.io/docs/mpg/create-and-connect/)):

| Plan        | CPU                        | RAM   | $/month   |
| ----------- | -------------------------- | ----- | --------- |
| Basic       | Shared-2x (2 shared vCPUs) | 1 GB  | $38.00    |
| Starter     | Shared-2x (2 shared vCPUs) | 2 GB  | $72.00    |
| Launch      | Performance-2x             | 8 GB  | $282.00   |
| Scale       | Performance-4x             | 32 GB | $962.00   |
| Performance | Performance-8x             | 64 GB | $1,922.00 |

- "All plans include high availability, backups, and connection pooling."
  "Every plan runs a primary and a replica with automatic failover, and
  storage is replicated across all nodes in the cluster" ([fly.io/mpg](https://fly.io/mpg/)).
  "Scaling down to one node is not an option for MPG clusters ... Each cluster
  also includes a 2-node PgBouncer set up" (Sam-Fly,
  [community 25884](https://community.fly.io/t/managed-postgres-starter-plan/25884)).
  HA is "within one region" only ([fly.io/mpg](https://fly.io/mpg/)).
- Storage: "$0.28 per provisioned GB for a 30-day month"; default volume
  10 GB (`fly mpg create --volume-size` "default 10"), so $2.80/mo minimum;
  max 1 TB, up to 500 GB at creation ([docs/mpg](https://fly.io/docs/mpg/)).
- Backups kept ten days, included ([fly.io/mpg](https://fly.io/mpg/)).
- Data transfer: "Starting February 2026, inter-region private network usage
  will be charged at the same rate as Machines ... There will be no charges
  for transfer within the same region" ([docs/mpg](https://fly.io/docs/mpg/);
  [community 26561](https://community.fly.io/t/we-are-going-to-start-charging-for-mpg-inter-region-private-network-usage-from-febuary-2026/26561)).
  Public egress (which the proxy path would incur toward Vercel) is $0.02/GB
  in North America & Europe ([pricing](https://fly.io/docs/about/pricing/)).
- Proration: "Clusters created or deleted mid-month will have their pricing
  prorated accordingly" ([docs/mpg](https://fly.io/docs/mpg/)).
- Starter was added 2025-09-10 because "the increase in price from Basic ($38)
  to Launch ($282) was huge" (lubien, Fly,
  [community 25884](https://community.fly.io/t/managed-postgres-starter-plan/25884)).

**Neon** ([neon.com/pricing](https://neon.com/pricing), verified 2026-09-04):

|                  | Free                 | Launch                               | Scale          |
| ---------------- | -------------------- | ------------------------------------ | -------------- |
| Compute          | 100 CU-hours/project | $0.106/CU-hour                       | $0.222/CU-hour |
| Storage          | 0.5 GB/project       | $0.35/GB-month                       | $0.35/GB-month |
| Branches/project | 10                   | 10                                   | 25             |
| Extra branches   | –                    | $1.50/branch-month (prorated hourly) | same           |
| Instant restore  | –                    | $0.20/GB-month                       | $0.20/GB-month |
| History window   | 6 h (1 GB limit)     | up to 7 days                         | up to 30 days  |
| Scale to zero    | after 5 min          | after 5 min, can be disabled         | configurable   |
| Egress           | 5 GB                 | 500 GB/project then $0.10/GB         | same           |

"Paid plans are pay-as-you-go: usage is metered hourly and billed at the end
of the month, with no monthly minimum." "Suspended (scaled-to-zero) compute =
$0."

**Worked comparison — one tiny production DB, ~10 short-lived previews/day**
(arithmetic mine; inputs cited above; preview lifetime assumed):

- _Neon Launch_: production at 0.25 CU, never suspended: 0.25 × 730 h ×
  $0.106 ≈ **$19.35**. Storage 1 GB ≈ $0.35. Previews: 10/day, each branch's
  compute awake ~1 h before suspending: 300 × 0.25 CU-h × $0.106 ≈ **$7.95**;
  branches under the included 10 at any instant, or $1.50/branch-month
  prorated hourly (cents). Total ≈ **$28/mo**; less if production also
  scales to zero. Neon Free (100 CU-hours, 0.5 GB, 10 branches) might carry
  a pre-launch product at $0.
- _MPG, previews as databases on the production cluster_: Basic $38 + 10 GB
  $2.80 + proxy Machine ≈ $2 + dedicated IPv4 $2 ≈ **$45/mo**, and previews
  cost nothing extra but share the cluster's 100-connection ceiling and
  cannot be deleted from the CLI.
- _MPG, previews as forks_ (v2, dashboard-only, not in `iad`): each fork is a
  Basic cluster at ≈ $0.053/h + 10 GB storage prorated; 10/day living ~4 h ≈
  40 cluster-hours/day ≈ **$63/mo** on top of the ≈ $45 above.

MPG is the more expensive option in every configuration and the gap widens
with previews.

## 4. Maturity

- **Origin:** Fly's January 2025 newsletter: "for the past several months,
  we've been building our own managed Postgres, Fly MPG ... built Fly MPG on
  Percona ... running on Percona's K8s operator infrastructure ... it'll be
  ready to play with within the next month-ish"
  ([newsletter text, mirrored gist](https://gist.github.com/karlhorky/f80217c1e908e5c3bbdaffb002c55eb9)).
  Overview doc dated 2025-07-10 ([docs/mpg](https://fly.io/docs/mpg/)).
- **GA date: not found.** No doc or staff post says "generally available" or
  "GA"; the v1 docs carry no beta label. **Unverified** whether v1 was ever
  formally declared GA.
- **v2 rewrite, 2026:** "The original Fly Managed Postgres runs on FKS. That
  caused some stability problems due to the unique problems that come with
  that. Managed Postgres v2 is built directly on Fly Machines ... The main
  goal is stability." Beta in `dfw` only, "It costs the same" (akshit-fly,
  2026-05-19, [community 27909](https://community.fly.io/t/managed-postgres-v2-is-now-in-beta/27909));
  `yyz` added 2026-06-09. "MPGv1 is still supported fwiw"; auto-migration
  "MIGHT" happen later. A user's reaction in that thread: "This is the 4th
  version of postgres on fly.io and more often than not, it leaves customers
  in a tough spot with no auto migration."
- **v1→v2 migration reports (Aug 2026):** promote failed with "couldn't find
  the prepared v2 standby" until Fly "fixed a couple of wrinkles"; then a
  "~15 min production outage" because the old pgbouncer hostname "went
  NXDOMAIN at promotion" and the app attachment did not carry over; a second
  user stuck "for maybe 2 days" with the Databases tab returning a 500
  ([community 28540](https://community.fly.io/t/mpg-v2-migration-stuck-standby-is-ready-but-promote-fails-with-couldnt-find-the-prepared-v2-standby/28540)).
- **Documented gaps, still live 2026-09-04:** "At the moment, the following
  features are under development: Security patches and version upgrades;
  Third Party Postgres extensions besides pgvector or postGIS;
  Customer-facing alerting; Database migration tools"
  ([docs/mpg](https://fly.io/docs/mpg/)).
- **Extensions:** default PG 16 trusted extensions, `pgvector`, `PostGIS`
  (`--enable-postgis-support` at create). Of ~70 bundled extensions ~40 are
  toggleable per database from the dashboard; `dblink`, `postgres_fdw` and
  others are not; `plpgsql`, `pg_stat_monitor`, `pgaudit` are always on
  ([docs/mpg/extensions](https://fly.io/docs/mpg/extensions/)). No SQL
  `CREATE EXTENSION` for superuser-gated extensions
  ([community 28124](https://community.fly.io/t/mpg-superuser-permissions-for-extensions/28124)).
- **Postgres versions:** `--pg-major-version` "Supported versions are 16
  and 17. (default 16)" (`fly mpg create --help`, local). Our Neon project
  is Postgres 18 (memory: maslow-repo-infra), so moving is a major
  downgrade; whether any migration relies on PG 18 behaviour is
  **unverified**.
- **Connections/pooling:** PgBouncer on every cluster, session (default) or
  transaction mode; changing mode "will restart the connection pooler nodes"
  ([cluster-configuration](https://fly.io/docs/mpg/cluster-configuration/)).
  Transaction mode: "`SET` commands affect only the current transaction",
  no named prepared statements, no LISTEN/NOTIFY, use the direct URL for
  migrations; Fly's proxy has a 10-minute shutdown timeout so clients must
  recycle connections (`maxLifetimeSeconds: 600`)
  ([client-configuration](https://fly.io/docs/mpg/client-configuration/)).
  Limits: 200 client / 50 backend / `max_connections` 100 (staff,
  [community 26655](https://community.fly.io/t/confusion-about-mpg-connection-limits/26655)).
- **Incidents:** "Anyone else having a managed Postgres outage in fra or
  elsewhere?" — 2026-05-16, multiple users, Fly support "investigating
  connectivity issues", status-page entry opened
  ([community 27890](https://community.fly.io/t/anyone-else-having-a-managed-postgres-outage-in-fra-or-elsewhere/27890)).
  A thread titled "URGENT production outage: all MPG clusters in ord
  unavailable, Postgres nodes unreachable behind healthy pgbouncer" (id
  28522, ~Aug 2026) appears in search results but returns 404/private, so
  its content is **unverified**.
- **Regions:** ams, dfw, fra, gru, iad, lax, lhr, nrt, ord, sin, sjc, syd, yyz
  ([fly.io/mpg](https://fly.io/mpg/)); v2 only dfw and yyz.
- **Support:** "Fly.io Support Portal to log tickets and get help" is
  included with MPG ([docs/mpg](https://fly.io/docs/mpg/)).

## 5. Roles and forced row-level security

**Can roles be created with plain SQL? No.**

- Zitadel's container failed with `ERROR: permission denied to create role
(SQLSTATE 42501)`; Fly staff (lillian, 2025-09-08): "I don't believe the
  Role system lets you create new roles/users through the postgres
  connection, but only through the dashboard, unfortunately."
  ([community 25854](https://community.fly.io/t/how-to-deploy-zitadel-auth-container-with-fly-io-managed-postgres/25854)).
- Roles come from `fly mpg users create <CLUSTER_ID> -u <name> -r
schema_admin|writer|reader` and `fly mpg users set-role` (local help;
  announced [community 26427](https://community.fly.io/t/flyctl-can-now-manage-mpg-users-and-databases/26427)).
  How the password is returned to a script is not shown in the help text;
  the dashboard "Connect" tab generates the connection string
  ([cluster-configuration](https://fly.io/docs/mpg/cluster-configuration/)).
  **Unverified** whether `fly mpg users create` prints the password or
  whether it can be set/rotated non-interactively (needed to keep our
  derived-password scheme in `preview-db.mjs`).

**Does `fly mpg users` create superusers? No.** The three roles are
Schema Admin ("the closest to a Superuser role ... cannot: Create new
databases ... Other actions requiring superuser permissions"), Writer
("cannot ... Alter database permissions or roles ... Create temporary
tables"), Reader (SELECT only). `fly-user` is Schema Admin by default
([cluster-configuration](https://fly.io/docs/mpg/cluster-configuration/)).
Fly staff on full superuser: "isn't something we're planning at this time"
([community 28124](https://community.fly.io/t/mpg-superuser-permissions-for-extensions/28124)).

**Does the `writer` role bypass RLS?** **Unverified.** No Fly document
mentions `BYPASSRLS`. The Writer description ("Read from and write to all
existing tables and schemas ... Connect to any database in the cluster") reads
like Postgres's predefined `pg_write_all_data`/`pg_read_all_data` roles, which
per PostgreSQL's own docs do not carry `BYPASSRLS` — but that is an inference
about Fly's implementation, not a fact. The Neon trap was real precisely
because the docs said so: "Your Postgres role and roles created in the Neon
Console, API, and CLI are granted membership in the neon_superuser role ...
BYPASSRLS: Provides the ability to bypass row-level security (RLS) policies"
([neon.com/docs/manage/roles](https://neon.com/docs/manage/roles)). On MPG
the equivalent check would be the first thing to run:
`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`
as the `writer` role, then a negative test through `pgbouncer.` in
transaction mode.

Two things do carry over: our migrations already `force row level security`
on every tenant table (e.g. `packages/db/migrations/20260904_055950_brain.sql`),
so the Schema Admin that owns the tables is covered; and the pooler caveat we
already handle for Neon ("a once-set `app.org_id` comes back `''`") has an MPG
analogue — in transaction mode "`SET` commands affect only the current
transaction", so the org setting must be `set_config(..., true)` inside the
transaction that reads it.

---

## Migration sketch (only if the "move later" conditions are met)

Named against the repo as it stands; every step that touches an unverified
capability says so.

1. **Cluster.** `fly mpg create -n maslow-prod --plan Basic -r iad
--pg-major-version 17 --volume-size 10` (v2 in `iad` is a precondition;
   PG 18 → 17 downgrade must be tested with `pg_dump | psql` first). One
   cluster, two logical databases at least: `prod` and a `preview-parent`
   template. Expect ≈ $41/mo before any preview.
2. **Reaching it from Vercel.** Either move `apps/web` to Fly Machines and
   `fly mpg attach` (sets `DATABASE_URL` to the pooled URL; use a
   `release_command` with `DIRECT_DATABASE_URL` for migrations, per
   [client-configuration](https://fly.io/docs/mpg/client-configuration/)), or
   deploy `fly-mpg-proxy` in `iad` with a dedicated IPv4, keep the whitelist
   open (Vercel has no fixed egress — unverified), run two Machines, point
   `DATABASE_URL` at `<proxy>.fly.dev:6432` (pooled, transaction mode) and
   `DATABASE_OWNER_URL` at `<proxy>.fly.dev:5432` (direct; migrations use
   advisory-lock semantics). Confirm TLS on 5432 through the proxy before
   putting owner credentials on it (unverified). Set `maxLifetimeSeconds:
600` and `idleTimeoutMillis: 300_000` in the `pg` pool.
3. **Roles.** `fly mpg users create <cluster> -u app -r writer` once for the
   whole cluster (roles are cluster-wide: "Connect to any database in the
   cluster"), so a preview database is not isolated from production by role
   the way a Neon branch is by endpoint — the only wall is `CONNECT`
   privilege per database, which Schema Admin may or may not be allowed to
   revoke (unverified). Run the `rolbypassrls` tripwire and add it to the
   smoke.
4. **Per-PR previews.** In `scripts/preview-db.mjs` `up`: replace the Neon
   branch call with `fly mpg databases create <cluster> -n pr-<N>` (shelling
   out to flyctl, or the API it calls — undocumented), then
   `scripts/migrate.mjs` against `DATABASE_OWNER_URL` with `/pr-<N>` as the
   path, then seed. Write the two Vercel rows as today. `down`: there is no
   CLI delete; attempt `DROP DATABASE "pr-<N>"` as Schema Admin over the
   direct URL and, if that is refused (unverified either way), the nightly
   reap can only orphan-mark, not remove — which violates the field guide's
   "things fail to outlive their owner". Budget connections: ten previews ×
   serverless bursts share 200 pooled / 50 backend.
5. **Cutover from Neon.** `fly mpg proxy` locally; `pg_dump
"$NEON_OWNER_URL" | psql "postgres://fly-user:...@localhost:16380/prod"`
   (Fly's documented import path is exactly this:
   [docs/mpg/import](https://fly.io/docs/mpg/import/) — "Your new cluster
   must be created with a volume at least as large as the database you're
   importing"). Freeze writes, dump, restore, run the RLS tripwire and the
   smoke against MPG, swap the two production rows in Vercel, redeploy,
   watch, then delete the Neon project after MPG has ten days of backups.
6. **Vendor register.** Add MPG and fly-mpg-proxy to `docs/dependencies.md`
   in the same commit, per the field guide.

## Risks and what stays unknown

- **Exposure.** Production Postgres reachable from any IP behind a password,
  through a component Fly says it does not support. That is the shape Neon
  avoids by design.
- **Single region, single provider hop.** HA is within one region; every
  query crosses Vercel → Fly.
- **Preview lifecycle.** No documented database delete; no fork in `iad`;
  forks are billed clusters.
- **Roles.** No SQL roles; `BYPASSRLS` status of Fly roles unknown; password
  retrieval for CLI-created users unknown; per-database `CONNECT` isolation
  unknown.
- **Version.** PG 16/17 only versus Neon PG 18.
- **Platform churn.** v1 "caused some stability problems"; v2 is beta with
  a manual migration that has already cost users a 15-minute outage;
  "security patches and version upgrades" still under development.
- **Unverified in this research:** MPG v1 GA date; PITR window length;
  cluster create/fork/restore durations; the content of the ord outage
  thread (28522); Vercel egress-IP behaviour; TLS on the proxy's port 5432;
  `DROP DATABASE`/`REVOKE CONNECT` rights for Schema Admin; how
  `fly mpg users create` hands back a password; whether the `writer` role is
  `BYPASSRLS`.

## Sources

- https://fly.io/docs/mpg/ · https://fly.io/docs/mpg/create-and-connect/ ·
  https://fly.io/docs/mpg/client-configuration/ ·
  https://fly.io/docs/mpg/cluster-configuration/ ·
  https://fly.io/docs/mpg/import/ · https://fly.io/docs/mpg/extensions/ ·
  https://fly.io/docs/mpg/metrics/ · https://fly.io/mpg/ ·
  https://fly.io/docs/about/pricing/
- https://github.com/fly-apps/fly-mpg-proxy (README)
- community.fly.io threads 25477, 25854, 25884, 25932, 26213, 26427, 26561,
  26655, 27103, 27890, 27909, 28057, 28124, 28292, 28464, 28466, 28540
- https://neon.com/pricing · https://neon.com/docs/introduction/branching ·
  https://neon.com/docs/manage/roles
- Local: `fly version` (v0.4.99), `fly mpg --help`, `fly mpg create --help`,
  `fly mpg databases --help`, `fly mpg databases create --help`,
  `fly mpg users --help`, `fly mpg users create --help`,
  `fly mpg users set-role --help`, `fly mpg restore --help`,
  `fly mpg attach --help`, `fly mpg proxy --help`, `fly mpg connect --help`,
  `fly mpg backup --help`, `fly mpg backup list --help` — run 2026-09-04,
  read-only.
