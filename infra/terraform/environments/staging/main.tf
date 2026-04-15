terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

resource "aws_s3_bucket" "crewcue_staging_artifacts" {
  bucket = "${var.project_name}-staging-artifacts"
}

resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/crewcue/staging/api"
  retention_in_days = 14
}
