# ---------------------------------------------------------------------------
# General
# ---------------------------------------------------------------------------

variable "project" {
  description = "Project name. Prefixes every resource name."
  type        = string
  default     = "zipwyn"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.project))
    error_message = "project must be 2-21 lowercase letters, numbers or hyphens, starting with a letter."
  }
}

variable "environment" {
  description = "Environment label used in tags."
  type        = string
  default     = "production"
}

variable "aws_region" {
  description = "AWS region for every resource, including the ACM certificate (regional API Gateway domains need the certificate in the same region)."
  type        = string
  default     = "ap-southeast-1"
}

# ---------------------------------------------------------------------------
# Domains (DNS is managed manually at Name.com)
# ---------------------------------------------------------------------------

variable "root_domain" {
  description = "Registered domain whose DNS is managed at Name.com."
  type        = string
  default     = "navindalc.app"
}

variable "redirect_subdomain" {
  description = "Subdomain that serves public short links (https://<redirect_subdomain>.<root_domain>/<code>)."
  type        = string
  default     = "zip"
}

variable "api_subdomain" {
  description = "Subdomain of the management API used by the Zipwyn web app (create / list / stats)."
  type        = string
  default     = "zipwyn-api"
}

variable "frontend_subdomain" {
  description = "Subdomain of the Zipwyn web app. Only used to build the default CORS allow-list."
  type        = string
  default     = "zipwyn"
}

variable "redirect_extra_domains" {
  description = "Additional full domain names that should also serve short links, for example a legacy domain such as short.navindalc.app so previously shared links keep working."
  type        = list(string)
  default     = []
}

variable "enable_custom_domains" {
  description = "Create API Gateway custom domains. Leave false for the first apply, add the ACM validation DNS records, then set to true. See Deployment.md."
  type        = bool
  default     = false
}

variable "cors_allowed_origins" {
  description = "Browser origins allowed to call the management API. Defaults to the Zipwyn web app origin."
  type        = list(string)
  default     = []
}

variable "disable_default_endpoints" {
  description = "Disable the default execute-api endpoints so both APIs are only reachable through their custom domains. Enable after the custom domains work."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

variable "dynamodb_table_name" {
  description = "Name of the DynamoDB table that stores links."
  type        = string
  default     = "zipwyn-urls"
}

variable "dynamodb_users_table_name" {
  description = "Name of the DynamoDB table that stores Zipwyn users."
  type        = string
  default     = "zipwyn-users"
}

variable "dynamodb_accounts_table_name" {
  description = "Name of the DynamoDB table that stores Zipwyn accounts."
  type        = string
  default     = "zipwyn-accounts"
}

variable "dynamodb_deletion_protection" {
  description = "Protect the DynamoDB table from accidental deletion."
  type        = bool
  default     = true
}

# ---------------------------------------------------------------------------
# Lambda
# ---------------------------------------------------------------------------

variable "lambda_runtime" {
  description = "Lambda runtime for all functions."
  type        = string
  default     = "nodejs24.x"
}

variable "lambda_architecture" {
  description = "Lambda CPU architecture. arm64 (Graviton) is cheaper and faster for this workload."
  type        = string
  default     = "arm64"

  validation {
    condition     = contains(["arm64", "x86_64"], var.lambda_architecture)
    error_message = "lambda_architecture must be arm64 or x86_64."
  }
}

variable "lambda_memory_size" {
  description = "Memory (MB) for every function."
  type        = number
  default     = 256
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for Lambda and API access logs."
  type        = number
  default     = 30
}

# ---------------------------------------------------------------------------
# Protection & operations
# ---------------------------------------------------------------------------

variable "management_api_key" {
  description = "Optional shared secret. When set, create / list / stats requests must send it in the x-api-key header. Leave empty to keep the management API open (not recommended for production)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "redirect_throttle" {
  description = "Throttling for the public redirect API (requests per second / burst)."
  type = object({
    rate  = number
    burst = number
  })
  default = {
    rate  = 100
    burst = 200
  }
}

variable "management_throttle" {
  description = "Throttling for the management API (requests per second / burst)."
  type = object({
    rate  = number
    burst = number
  })
  default = {
    rate  = 10
    burst = 20
  }
}

variable "alarm_email" {
  description = "Email address that receives CloudWatch alarm notifications (Lambda errors, API 5xx). Leave empty to skip creating alarms. AWS sends a confirmation email that must be accepted."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Extra tags added to every resource."
  type        = map(string)
  default     = {}
}
