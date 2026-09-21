# Maslow in one AWS account: the network, the database, the store for
# files and the secrets the app reads, and on them the front door, the app,
# the relay and their chores. Runs under Terraform or OpenTofu alike.

terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # What was built is kept in a bucket of the account's own, locked while a
  # run holds it. The bucket and key are given at `init`; see README.md.
  backend "s3" {
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.region

  # Every resource says what it is and whose, so any bill traces back.
  default_tags {
    tags = {
      app         = "maslow"
      environment = var.name
      managed-by  = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "here" {
  state = "available"
}

locals {
  site = "https://${var.domain}"
}
