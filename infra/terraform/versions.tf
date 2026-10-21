terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Remote state in S3 with native state locking (Terraform >= 1.10).
  # The bucket is configured at init time so no account-specific values are committed:
  # terraform init -backend-config=backend.hcl
  # See Deployment.md and backend.hcl.example.
  # backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}
