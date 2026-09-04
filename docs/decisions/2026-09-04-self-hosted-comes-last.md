# 2026-09-04 — self-hosted comes last

A good developer experience across local, preview and production is already
the whole of what the team can carry, so self-hosting is deferred until the
managed product is good. Everything written for it is removed rather than left
half-true: the field guide's self-hosting section, the OpenID Connect sign-in
path and its `AUTH_*` values, the self-hosted columns of the dependency
register, and the container profile for machines.

What stays is the shape that makes it cheap later: one org is the same object
whether it is alone or among thousands, every vendor sits behind an interface
of ours, and one object says what a deployment can do. Self-hosting, when it
comes, is a second implementation behind those interfaces, not a second code
path.
