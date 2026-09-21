# The chores Vercel's cron runs for the managed product, on the same
# timetable in UTC and with the same secret: the hourly sweep that meters
# and cleans, and the look at the computers' disks every ten minutes. A
# chore missed is not tried again, since the next one does its work anyway.

locals {
  chores = {
    sweep = "cron(7 * * * ? *)"
    disks = "cron(0/10 * * * ? *)"
  }
}

resource "aws_cloudwatch_event_connection" "chores" {
  name               = "${var.name}-chores"
  description        = "The secret the app asks of a chore"
  authorization_type = "API_KEY"
  auth_parameters {
    api_key {
      key   = "Authorization"
      value = "Bearer ${random_password.cron.result}"
    }
  }
}

resource "aws_cloudwatch_event_api_destination" "chore" {
  for_each                         = local.chores
  name                             = "${var.name}-${each.key}"
  connection_arn                   = aws_cloudwatch_event_connection.chores.arn
  invocation_endpoint              = "${local.site}/meter/${each.key}"
  http_method                      = "GET"
  invocation_rate_limit_per_second = 1
}

resource "aws_cloudwatch_event_rule" "chore" {
  for_each            = local.chores
  name                = "${var.name}-${each.key}"
  schedule_expression = each.value
  state               = var.release == "" ? "DISABLED" : "ENABLED"
}

resource "aws_iam_role" "chores" {
  name = "${var.name}-chores"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "chores" {
  name = "call"
  role = aws_iam_role.chores.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "events:InvokeApiDestination"
      Resource = [for d in aws_cloudwatch_event_api_destination.chore : d.arn]
    }]
  })
}

resource "aws_cloudwatch_event_target" "chore" {
  for_each = local.chores
  rule     = aws_cloudwatch_event_rule.chore[each.key].name
  arn      = aws_cloudwatch_event_api_destination.chore[each.key].arn
  role_arn = aws_iam_role.chores.arn
  retry_policy {
    maximum_retry_attempts       = 0
    maximum_event_age_in_seconds = 60
  }
}
