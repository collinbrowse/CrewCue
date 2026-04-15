variable "project_name" {
  type        = string
  description = "Project name prefix for resources."
  default     = "crewcue"
}

variable "aws_region" {
  type        = string
  description = "AWS region for staging resources."
  default     = "us-east-1"
}
