# The app and the relay, each a container Fargate runs, reached only
# through the front door. The app runs one copy and brings a new release up
# before the old goes down; the relay is only ever one copy, since a
# document is live in one place, so the old stops before the new starts.
# Both are given their settings from the two secrets as they start, and
# neither exists until a release is named, so the first release has no
# empty one before it to be rolled back to.

locals {
  running = var.release == "" ? 0 : 1
  image   = { for k, r in aws_ecr_repository.image : k => "${r.repository_url}:${var.release}" }

  from_app     = ["DATABASE_OWNER_URL", "DATABASE_URL", "STORAGE_ENDPOINT", "STORAGE_REGION", "STORAGE_BUCKET", "STORAGE_ACCESS_KEY", "STORAGE_SECRET_KEY", "SYNC_SECRET", "CRON_SECRET", "APP_URL"]
  from_vendors = ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "RESEND_API_KEY", "MAIL_FROM"]
}

resource "aws_ecs_cluster" "main" {
  name = var.name
}

resource "aws_cloudwatch_log_group" "run" {
  for_each          = toset(["app", "sync"])
  name              = "/${var.name}/${each.key}"
  retention_in_days = 14
}

# What starts the containers: it pulls their images, writes their logs and
# reads the two secrets, and nothing else. The containers themselves are
# given no AWS identity; the app reaches its files with its own key.
resource "aws_iam_role" "starter" {
  name = "${var.name}-starter"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "starter" {
  role       = aws_iam_role.starter.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# The app makes and takes away a person's computer, and tells the front
# door which names to carry to it. It holds no key for this: the role it
# runs as is what AWS knows it by.
resource "aws_iam_role" "app" {
  name = "${var.name}-app-runtime"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# What the app may do to the account. Everything it makes carries this
# deployment's name as a tag, and it may change or take away only what
# carries it: nothing else in the account is within its reach, whoever
# else shares the account. Looking is not limited, since AWS cannot limit
# it by tag. A tag may be written only as a thing is made, or onto what is
# already this deployment's.
locals {
  made_by     = "maslow-cloud:deployment"
  ours        = { StringEquals = { "aws:ResourceTag/${local.made_by}" = var.name } }
  made_ours   = { StringEquals = { "aws:RequestTag/${local.made_by}" = var.name } }
  ec2_here    = "arn:${data.aws_partition.here.partition}:ec2:${var.region}:${data.aws_caller_identity.current.account_id}"
  ec2_amazons = "arn:${data.aws_partition.here.partition}:ec2:${var.region}:"
  door_rules  = replace(aws_lb_listener.https.arn, ":listener/", ":listener-rule/")
}

data "aws_partition" "here" {}

resource "aws_iam_role_policy" "app_computers" {
  name = "computers"
  role = aws_iam_role.app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Look"
        Effect   = "Allow"
        Action   = ["ec2:Describe*", "elasticloadbalancing:Describe*"]
        Resource = "*"
      },
      {
        # A machine, a disk and a copy are made only with the name on them.
        Sid    = "MakeNamed"
        Effect = "Allow"
        Action = ["ec2:RunInstances", "ec2:CreateVolume", "ec2:CreateSnapshot"]
        Resource = [
          "${local.ec2_here}:instance/*",
          "${local.ec2_here}:volume/*",
          "${local.ec2_amazons}:snapshot/*",
        ]
        Condition = local.made_ours
      },
      {
        # What a machine is made from and stands in: Amazon's Linux, and
        # this deployment's own subnets and firewall.
        Sid    = "MakeFrom"
        Effect = "Allow"
        Action = "ec2:RunInstances"
        Resource = concat(
          ["${local.ec2_amazons}:image/*", "${local.ec2_here}:network-interface/*"],
          [for s in aws_subnet.public : s.arn],
          [aws_security_group.computer.arn],
        )
      },
      {
        # A copy is made of a disk of ours, and a disk filled from a copy
        # of ours.
        Sid    = "MakeFromOurs"
        Effect = "Allow"
        Action = ["ec2:CreateSnapshot", "ec2:CreateVolume"]
        Resource = [
          "${local.ec2_here}:volume/*",
          "${local.ec2_amazons}:snapshot/*",
        ]
        Condition = local.ours
      },
      {
        Sid    = "ChangeOurs"
        Effect = "Allow"
        Action = [
          "ec2:TerminateInstances",
          "ec2:StartInstances",
          "ec2:StopInstances",
          "ec2:RebootInstances",
          "ec2:ModifyInstanceAttribute",
          "ec2:AttachVolume",
          "ec2:DetachVolume",
          "ec2:ModifyVolume",
          "ec2:DeleteVolume",
          "ec2:DeleteSnapshot",
          "ec2:CreateTags",
        ]
        Resource  = "*"
        Condition = local.ours
      },
      {
        Sid      = "NameAsMade"
        Effect   = "Allow"
        Action   = "ec2:CreateTags"
        Resource = "*"
        Condition = {
          StringEquals = { "ec2:CreateAction" = ["RunInstances", "CreateVolume", "CreateSnapshot"] }
        }
      },
      {
        # The role a machine boots with is one the app hands over, and the
        # only one it may.
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = aws_iam_role.computer.arn
        Condition = {
          StringEquals = { "iam:PassedToService" = "ec2.amazonaws.com" }
        }
      },
      {
        # A computer's way through the front door: a group and a rule,
        # made with the name on them, on this front door alone.
        Sid       = "DoorMakeGroup"
        Effect    = "Allow"
        Action    = "elasticloadbalancing:CreateTargetGroup"
        Resource  = "*"
        Condition = local.made_ours
      },
      {
        Sid       = "DoorMakeRule"
        Effect    = "Allow"
        Action    = "elasticloadbalancing:CreateRule"
        Resource  = [aws_lb_listener.https.arn, "${local.door_rules}/*"]
        Condition = local.made_ours
      },
      {
        Sid      = "DoorNameAsMade"
        Effect   = "Allow"
        Action   = "elasticloadbalancing:AddTags"
        Resource = "*"
        Condition = {
          StringEquals = { "elasticloadbalancing:CreateAction" = ["CreateTargetGroup", "CreateRule"] }
        }
      },
      {
        Sid    = "DoorChangeOurs"
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:DeleteTargetGroup",
          "elasticloadbalancing:RegisterTargets",
          "elasticloadbalancing:DeregisterTargets",
          "elasticloadbalancing:DeleteRule",
        ]
        Resource  = "*"
        Condition = local.ours
      },
    ]
  })
}

resource "aws_iam_role_policy" "starter_secrets" {
  name = "secrets"
  role = aws_iam_role.starter.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "secretsmanager:GetSecretValue"
      Resource = [aws_secretsmanager_secret.app.arn, aws_secretsmanager_secret.vendors.arn]
    }]
  })
}

resource "aws_ecs_task_definition" "app" {
  count                    = local.running
  family                   = "${var.name}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.starter.arn
  task_role_arn            = aws_iam_role.app.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }
  container_definitions = jsonencode([{
    name         = "app"
    image        = local.image["app"]
    essential    = true
    portMappings = [{ containerPort = 8080 }]
    environment = [
      { name = "APP_VERSION", value = var.release },
      { name = "SYNC_URL", value = "wss://sync.${var.domain}" },
      { name = "SERVICES_OFF", value = "analytics,speech" },
      { name = "AWS_COMPUTERS_NAME", value = var.name },
      { name = "AWS_COMPUTERS_REGION", value = var.region },
      { name = "AWS_COMPUTERS_SUBNETS", value = join(",", aws_subnet.public[*].id) },
      { name = "AWS_COMPUTERS_FIREWALL", value = aws_security_group.computer.id },
      { name = "AWS_COMPUTERS_VPC", value = aws_vpc.main.id },
      { name = "AWS_COMPUTERS_LISTENER", value = aws_lb_listener.https.arn },
      { name = "AWS_COMPUTERS_OS", value = nonsensitive(data.aws_ssm_parameter.computer_os.value) },
      { name = "AWS_COMPUTERS_PROFILE", value = aws_iam_instance_profile.computer.name },
      { name = "AWS_COMPUTERS_REGISTRY", value = aws_ecr_repository.image["computer"].repository_url },
      { name = "AWS_MACHINES_DOMAIN", value = var.domain },
    ]
    secrets = concat(
      [for k in local.from_app : { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }],
      [for k in local.from_vendors : { name = k, valueFrom = "${aws_secretsmanager_secret.vendors.arn}:${k}::" }],
    )
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.run["app"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "app"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "sync" {
  count                    = local.running
  family                   = "${var.name}-sync"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.starter.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }
  container_definitions = jsonencode([{
    name         = "sync"
    image        = local.image["sync"]
    essential    = true
    portMappings = [{ containerPort = 8080 }]
    environment  = [{ name = "SYNC_PORT", value = "8080" }]
    secrets      = [{ name = "SYNC_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:SYNC_SECRET::" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.run["sync"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "sync"
      }
    }
  }])
}

# A release that never comes up healthy is rolled back to the last that
# did. The app migrates the database before it answers, so it is given
# five minutes to.
resource "aws_ecs_service" "app" {
  count                              = local.running
  name                               = "app"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.app[0].arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 300
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 8080
  }
  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "sync" {
  count                              = local.running
  name                               = "sync"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.sync[0].arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.sync.arn
    container_name   = "sync"
    container_port   = 8080
  }
  depends_on = [aws_lb_listener_rule.sync]
}
