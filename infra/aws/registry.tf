# Where the app's, the relay's and the computer's images are kept, and the
# builders that make them in the account from a copy of the code, so no one
# building a release needs Docker. A release is a commit: the app's and the
# relay's images are tagged with it and never overwritten. The computer's
# image is tagged with the label the app boots machines by, which changes
# when what is inside it changes.

resource "aws_ecr_repository" "image" {
  for_each             = toset(["app", "sync", "computer"])
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = !var.keep_on_destroy
  image_scanning_configuration {
    scan_on_push = true
  }
}

# The last twenty releases are kept, so one can be gone back to. They are
# counted, not dated, so a release still running is expired by twenty newer
# ones; twenty is room enough that a deployment is updated long before.
resource "aws_ecr_lifecycle_policy" "image" {
  for_each   = aws_ecr_repository.image
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last twenty releases"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

# The copies of the code the builder reads, kept a week.
resource "aws_s3_bucket" "builds" {
  bucket        = "${var.name}-builds-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "builds" {
  bucket                  = aws_s3_bucket.builds.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "builds" {
  bucket = aws_s3_bucket.builds.id
  rule {
    id     = "old-sources"
    status = "Enabled"
    filter {}
    expiration {
      days = 7
    }
  }
}

resource "aws_cloudwatch_log_group" "builds" {
  name              = "/${var.name}/builds"
  retention_in_days = 14
}

resource "aws_iam_role" "builder" {
  name = "${var.name}-builder"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "codebuild.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# The builder reads the code's copies, writes its log, and pushes to the two
# repositories and nowhere else.
resource "aws_iam_role_policy" "builder" {
  name = "build"
  role = aws_iam_role.builder.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = "${aws_s3_bucket.builds.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.builds.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:DescribeImages",
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = [for r in aws_ecr_repository.image : r.arn]
      },
    ]
  })
}

# The computer's image is a Linux for people, built for Intel as the
# machines are, so it is made by a builder of that kind.
resource "aws_codebuild_project" "computer" {
  name          = "${var.name}-computer"
  description   = "Builds the image a person's computer boots."
  service_role  = aws_iam_role.builder.arn
  build_timeout = 60

  source {
    type      = "S3"
    location  = "${aws_s3_bucket.builds.bucket}/source.zip"
    buildspec = file("${path.module}/buildspec-computer.yml")
  }

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    type            = "LINUX_CONTAINER"
    compute_type    = "BUILD_GENERAL1_LARGE"
    image           = "aws/codebuild/amazonlinux-x86_64-standard:5.0"
    privileged_mode = true
    environment_variable {
      name  = "REGISTRY"
      value = split("/", aws_ecr_repository.image["computer"].repository_url)[0]
    }
    environment_variable {
      name  = "NAME"
      value = var.name
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.builds.name
    }
  }
}

resource "aws_codebuild_project" "images" {
  name          = var.name
  description   = "Builds a release of the app and the relay into their repositories."
  service_role  = aws_iam_role.builder.arn
  build_timeout = 30

  source {
    type      = "S3"
    location  = "${aws_s3_bucket.builds.bucket}/source.zip"
    buildspec = file("${path.module}/buildspec.yml")
  }

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    type            = "ARM_CONTAINER"
    compute_type    = "BUILD_GENERAL1_MEDIUM"
    image           = "aws/codebuild/amazonlinux-aarch64-standard:3.0"
    privileged_mode = true
    environment_variable {
      name  = "REGISTRY"
      value = split("/", aws_ecr_repository.image["app"].repository_url)[0]
    }
    environment_variable {
      name  = "NAME"
      value = var.name
    }
  }

  logs_config {
    cloudwatch_logs {
      group_name = aws_cloudwatch_log_group.builds.name
    }
  }
}
