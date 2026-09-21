#!/bin/sh
# Takes away everything the app made for one deployment: machines, their
# disks and copies, and their ways through the front door. The template
# made none of these, so `terraform destroy` cannot, and a machine left
# standing is paid for and holds the network up. All of it carries the
# deployment's name as a tag, and only what carries it is touched. Run
# from infra/aws before taking a deployment down:
#
#   ./clear-computers.sh <name> [-y]
set -eu

name=${1:?"usage: clear-computers.sh <name> [-y]"}
sure=${2:-}
region=$(terraform output -raw region 2>/dev/null || echo "${AWS_REGION:?set AWS_REGION, or run where terraform output answers}")
tag="maslow-cloud:deployment"
export AWS_PAGER=""

machines=$(aws ec2 describe-instances --region "$region" \
  --filters "Name=tag:$tag,Values=$name" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
  --query 'Reservations[].Instances[].InstanceId' --output text)
disks=$(aws ec2 describe-volumes --region "$region" \
  --filters "Name=tag:$tag,Values=$name" "Name=status,Values=creating,available,in-use,error" \
  --query 'Volumes[].VolumeId' --output text)
copies=$(aws ec2 describe-snapshots --region "$region" --owner-ids self --filters "Name=tag:$tag,Values=$name" \
  --query 'Snapshots[].SnapshotId' --output text)
groups=""
for arn in $(aws elbv2 describe-target-groups --region "$region" \
  --query 'TargetGroups[?starts_with(TargetGroupName, `c-i-`)].TargetGroupArn' --output text); do
  owner=$(aws elbv2 describe-tags --region "$region" --resource-arns "$arn" \
    --query "TagDescriptions[0].Tags[?Key=='$tag'].Value | [0]" --output text)
  [ "$owner" = "$name" ] && groups="$groups $arn"
done

count() { set -- $1; echo $#; }
echo "$name in $region: $(count "$machines") machine(s), $(count "$disks") disk(s), $(count "$copies") cop(ies), $(count "$groups") way(s) through the front door"
[ -n "$machines$disks$copies$groups" ] || { echo "nothing to take"; exit 0; }
if [ "$sure" != "-y" ]; then
  printf "Take all of it away? People's files on these disks go with them. Type the deployment's name: "
  read -r answer
  [ "$answer" = "$name" ] || { echo "left as it was"; exit 1; }
fi

# A way through the front door first: its rule, then its group.
for arn in $groups; do
  lb=$(aws elbv2 describe-target-groups --region "$region" --target-group-arns "$arn" \
    --query 'TargetGroups[0].LoadBalancerArns[0]' --output text)
  if [ "$lb" != "None" ] && [ -n "$lb" ]; then
    for listener in $(aws elbv2 describe-listeners --region "$region" --load-balancer-arn "$lb" \
      --query 'Listeners[].ListenerArn' --output text); do
      for rule in $(aws elbv2 describe-rules --region "$region" --listener-arn "$listener" \
        --query "Rules[?Actions[?TargetGroupArn=='$arn']].RuleArn" --output text); do
        aws elbv2 delete-rule --region "$region" --rule-arn "$rule"
      done
    done
  fi
  aws elbv2 delete-target-group --region "$region" --target-group-arn "$arn"
done

if [ -n "$machines" ]; then
  aws ec2 terminate-instances --region "$region" --instance-ids $machines >/dev/null
  aws ec2 wait instance-terminated --region "$region" --instance-ids $machines
fi
# A machine's own disk went with it; the people's disks are asked for again.
for disk in $(aws ec2 describe-volumes --region "$region" \
  --filters "Name=tag:$tag,Values=$name" "Name=status,Values=creating,available,in-use,error" \
  --query 'Volumes[].VolumeId' --output text); do
  aws ec2 delete-volume --region "$region" --volume-id "$disk"
done
for copy in $copies; do
  aws ec2 delete-snapshot --region "$region" --snapshot-id "$copy"
done
echo "taken"
