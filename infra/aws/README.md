# Maslow in an AWS account

This template builds Maslow in one AWS account: a private network over two
data centres, the database, the store for files, the secrets the app is
given, and on them the front door, the app, the live-editing relay, their
scheduled chores, and what a person's computer stands on. The computers
themselves are made by the app, one per person. It runs under Terraform 1.10
or later, or OpenTofu, with the AWS CLI and git beside it.

## Once per account

The template keeps its record of what it built in a bucket of the
account's own. Make it once, private, versioned and encrypted:

```
B=maslow-tfstate-<account id>; R=us-east-2
aws s3api create-bucket --bucket $B --region $R --create-bucket-configuration LocationConstraint=$R
aws s3api put-public-access-block --bucket $B --region $R \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket $B --region $R --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket $B --region $R \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Maslow is reached at a name of its own, and the template needs that name's
DNS zone in the account. Make it once, then hand the name to it where the
parent domain's DNS is kept, with an `NS` record for each of the four name
servers this prints:

```
D=maslow.example.com
aws route53 create-hosted-zone --name $D --caller-reference "maslow-$(date +%s)" \
  --query DelegationSet.NameServers
```

## Build it

```
terraform init -backend-config="bucket=$B" -backend-config="key=<name>.tfstate" -backend-config="region=$R"
terraform plan -var domain=$D -out=plan.tfplan  # says what it will make; nothing is made
terraform apply plan.tfplan
```

`domain` is the name people reach Maslow at, and the relay answers at
`sync.` under it. `name` names every resource (`maslow-test` unless given);
`keep_on_destroy` is off for a test account and on for a customer's, where
taking it down keeps a last copy of the database and refuses to delete it by
accident.

After the first run, and before a release is named, enter the outside
services' keys into the `<name>/vendors` secret: WorkOS for sign-in and
Resend for mail. The template makes that secret empty and never writes over
what is entered, so an install built again starts empty too, and a release
run without them refuses every request and never comes up.

## Run a release

Nothing runs until a release is named. A release is a commit: `release.sh`
has the account's own builder make the app's and the relay's images from
the commit checked out, so no Docker is needed here, and prints its name.
Naming it starts both, and the app brings the database up to date before
it answers:

```
R=$(./release.sh) && terraform apply -var domain=$D -var release=$R
```

The release is named on its own line first: a build that failed prints no
release, and an apply with none takes the app and the relay down.

A newer release is run the same way. The app's new copy takes over before
the old one stops; the relay's stops first, so live editing reconnects
after a few seconds. A release that never comes up healthy is rolled back
on its own.

## Take it down

The template did not make people's computers, the app did, so it cannot
take them away: left standing, they go on being paid for, and the network
under them cannot be deleted. `clear-computers.sh` takes away everything
the app made for this deployment, which is everything carrying its name as
a tag: machines, their disks and copies, and their ways through the front
door. It says what it found and asks before it takes anything. People's
files on those disks go with them.

```
./clear-computers.sh <name>
terraform destroy -var domain=$D
```

A test account is taken down between sessions, so nothing is paid for
while nobody is testing.
