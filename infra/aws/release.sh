#!/bin/sh
# Builds the commit checked out into a release: the app's and the relay's
# images, made by the account's own builder and tagged with the commit.
# Run from infra/aws once the template is built; prints the release to name
# with `terraform apply -var release=...`.
set -eu

git diff --quiet HEAD || { echo "release: commit first; a release is a commit" >&2; exit 1; }
release=$(git rev-parse --short=12 HEAD)
region=$(terraform output -raw region)
builder=$(terraform output -json builder)
field() { printf '%s' "$builder" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0))['$1'])"; }

# The computer's image is named by its label and not by the commit, since
# a label stands for what is inside it; the app boots machines by it.
label=$(sed -n 's/^export const IMAGE = "\(.*\)";$/\1/p' \
  "$(git rev-parse --show-toplevel)/apps/web/lib/computer.ts")
[ -n "$label" ] || { echo "release: no computer image label in computer.ts" >&2; exit 1; }

if aws ecr describe-images --region "$region" --repository-name "$(field app)" \
  --image-ids imageTag="$release" >/dev/null 2>&1 &&
  aws ecr describe-images --region "$region" --repository-name "$(field sync)" \
    --image-ids imageTag="$release" >/dev/null 2>&1 &&
  aws ecr describe-images --region "$region" --repository-name "$(field computer)" \
    --image-ids imageTag="$label" >/dev/null 2>&1; then
  echo "$release"
  exit 0
fi

source=$(mktemp)
git -C "$(git rev-parse --show-toplevel)" archive --format=zip -o "$source" HEAD
aws s3 cp --quiet --region "$region" "$source" "s3://$(field sources)/$release.zip"
rm -f "$source"

start() {
  aws codebuild start-build --region "$region" --project-name "$1" \
    --source-location-override "$(field sources)/$release.zip" \
    --environment-variables-override "$2" \
    --query build.id --output text
}
app=$(start "$(field project)" name=RELEASE,value="$release",type=PLAINTEXT)
computer=$(start "$(field computerProject)" name=LABEL,value="$label",type=PLAINTEXT)
echo "release: building $release, and the computer's image as $label" >&2

# Both are waited for, so a release is named only once everything it runs
# is on the shelf.
failed=
for build in "$app" "$computer"; do
  while :; do
    status=$(aws codebuild batch-get-builds --region "$region" --ids "$build" \
      --query 'builds[0].buildStatus' --output text)
    [ "$status" = IN_PROGRESS ] || break
    sleep 20
  done
  [ "$status" = SUCCEEDED ] || failed="$failed $build ($status)"
done
if [ -n "$failed" ]; then
  echo "release: a build did not finish:$failed; its log is in CloudWatch under the builds group" >&2
  exit 1
fi
echo "$release"
