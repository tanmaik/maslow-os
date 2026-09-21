# Where the deployment is reached, and what a release is built into.

output "site" {
  value = local.site
}

output "region" {
  value = var.region
}

output "builder" {
  value = {
    project         = aws_codebuild_project.images.name
    computerProject = aws_codebuild_project.computer.name
    sources         = aws_s3_bucket.builds.bucket
    app             = aws_ecr_repository.image["app"].name
    sync            = aws_ecr_repository.image["sync"].name
    computer        = aws_ecr_repository.image["computer"].name
  }
}

# What the app is told so it can make a person's computer: where they
# stand, what they boot, what they wear and what they pull.
output "computers" {
  value = {
    name     = var.name
    region   = var.region
    subnets  = aws_subnet.public[*].id
    firewall = aws_security_group.computer.id
    os       = nonsensitive(data.aws_ssm_parameter.computer_os.value)
    profile  = aws_iam_instance_profile.computer.name
    registry = aws_ecr_repository.image["computer"].repository_url
    domain   = var.domain
  }
}

output "network" {
  value = {
    vpc             = aws_vpc.main.id
    public_subnets  = aws_subnet.public[*].id
    private_subnets = aws_subnet.private[*].id
    app_firewall    = aws_security_group.app.id
  }
}

output "database" {
  value = aws_db_instance.main.address
}

output "files" {
  value = aws_s3_bucket.files.bucket
}

output "secrets" {
  value = {
    app     = aws_secretsmanager_secret.app.arn
    vendors = aws_secretsmanager_secret.vendors.arn
  }
}
