# 2026-09-20 — computers on AWS

A customer who hosts Maslow gets the same computer every person has on the
managed product: their own machine, their own disk, their own Linux, always
on. On AWS that is an EC2 instance on an EBS volume, inside the network the
installer built, in `apps/web/lib/clouds/aws.ts`. Settled with Tanishk on
2026-09-20, for the customer, who need a computer each in the first delivery.

## What is the same as Fly

The image, the door, the three sockets, the person's Linux on a disk that
outlives the machine, two gigabytes of swap, a machine that never sleeps,
and updates as a new image label the person takes when they choose. The
image is the same `apps/computer` image on both clouds; on AWS it runs as
one container on the instance, so nothing about the person's Linux differs.

## What is different, and why

- **One region.** A deployment makes computers where it stands. Fly's
  proxy is global and reaches a machine in any region for nothing; a load
  balancer belongs to one network in one region, so a second region means
  a second front door and a second network. A deployment of twelve people
  in one country does not pay that, and nothing in the ids or the tags
  stops it being added: every id carries its region already.
- **No per-machine certificate.** The paused branch gave every computer a
  public address and its own certificate from Let's Encrypt. The front
  door holds one certificate for the domain and every name under it, so a
  machine is reached at its own name through the door, as it is on Fly.
  That keeps a government deployment off the public certificate
  authorities and leaves no plain port open to the internet.
- **Sizes are met on memory.** Memory is what a person runs out of and the
  processors sit idle, so today's computer — four shared processors and
  eight gigabytes — is a `t3.large`, about sixty dollars a month against
  Fly's forty-three. Matching the processors as well would be twice that.
  The size asked for is kept as a tag, so a listing answers with what was
  asked rather than what AWS rounded it to.
- **The machine's identity can do almost nothing, because the person can
  read it.** The door runs on the machine's own network, so a person with
  administrator rights on their own machine can read both what the machine
  was told at boot — its door's secret, its own brain token — and the
  identity it boots with. The first are that person's own credentials and
  open nobody else's. The second is why that identity may do one thing
  only: pull the computer image from the deployment's registry, which is
  the image they are already running. Anything a machine needs beyond that
  is given to it, never granted to it.
- **The relay is not a machine.** On Fly the sweep keeps one relay machine
  per environment. On AWS the relay runs beside the app as its own
  container, which the installer starts, so the cloud refuses to make one.

## What a machine is made of

The instance's startup script carries it: the disk formatted and mounted at
`/data` the first time and grown after, a swapfile, and the door as one
container pulled from the deployment's registry. The script runs at every
boot, so a reshape is a new script and a restart, and the environment rides
along in it as a comment, which a listing reads back. Nothing of what a
machine is made of is kept anywhere else.

## Ninety-eight to a front door

A computer is reached at its own name through the one front door, which
holds a group per computer. AWS allows a hundred groups to a door and does
not raise that number, whatever else it raises, and the app and the relay
hold two of them. So a deployment reaches ninety-eight computers, and the
ninety-ninth is refused in those words. More than that is a second front
door, which is also what a second region would need.

## What a boot costs

A machine's first boot installs Docker, mounts the person's disk, makes two
gigabytes of swap, pulls the computer's image from the deployment's own
registry and copies the Linux inside it onto the disk. Measured by
`scripts/check-computer.mjs` on a `t3.large`: the door answers about two
minutes after the machine is made, and about forty seconds after a restart,
which copies nothing. An update is a new label: the machine is remade to it
and pulls that image, and the person's disk is untouched.

## Copies are let go here

A copy of a disk carries the day it is kept until, and one past its day is
taken away when the next copy of that disk is made or when the disk itself
goes. AWS keeps a copy until it is asked to let go, and keeps it after its
disk is gone, so nothing else would.

## Nothing runs without a row

The hourly sweep lists the cloud's own machines and stops any of this
deployment's that no row holds, in every environment. On Fly we would find
a forgotten machine in our own bill; in a customer's account we never
would, and it is their money. Stopping ends nearly all of what a machine
costs. It is not destroyed and its disk is not touched: a database put back
from an older copy has no row for a machine made since, and a person's
files must not go because a row did. What was stopped is said in the log,
and letting it go is a person's decision. A machine under an hour old is
left alone, since a machine is made before its row names it and that takes
minutes; a machine a move is making, or still owes the cloud, is held by
that move. A pass that could not read every org stops nothing, since a
machine whose row went unread is not a machine without one. The reap
outside production is unchanged, and now reads whichever cloud the
environment names.

## Not this

- Not a machine image of our own: the instance boots Amazon's stock Linux
  and pulls ours, so an update is a pull and not a rebuild.
- Not a move between regions, while a deployment has one.
- Not the routing yet: a machine answers at its own name once the front
  door carries that name to it, which is the next piece.
