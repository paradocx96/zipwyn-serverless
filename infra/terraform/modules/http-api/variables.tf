variable "name" {
  description = "Name of the HTTP API (also used as a prefix for related resources)."
  type        = string
}

variable "description" {
  description = "Human-readable description of the API."
  type        = string
  default     = ""
}

variable "routes" {
  description = "Routes served by this API, keyed by a short, static identifier. Each route proxies to one Lambda function."
  type = map(object({
    route_key         = string # for example "GET /{shortCode}"
    lambda_name       = string # function name, used for the invoke permission
    lambda_invoke_arn = string # function invoke ARN, used as the integration URI
  }))
}

variable "cors" {
  description = "CORS configuration handled by API Gateway. Set to null to disable CORS."
  type = object({
    allow_origins = list(string)
    allow_methods = list(string)
    allow_headers = list(string)
    max_age       = optional(number, 600)
  })
  default = null
}

variable "throttling_rate_limit" {
  description = "Steady-state requests per second allowed on every route."
  type        = number
  default     = 100
}

variable "throttling_burst_limit" {
  description = "Maximum burst of concurrent requests allowed on every route."
  type        = number
  default     = 200
}

variable "disable_execute_api_endpoint" {
  description = "Disable the default https://<api-id>.execute-api.<region>.amazonaws.com endpoint so the API is only reachable through its custom domain(s)."
  type        = bool
  default     = false
}

variable "enable_custom_domains" {
  description = "Create the API Gateway custom domain name(s) and API mapping(s). Requires an issued ACM certificate."
  type        = bool
  default     = false
}

variable "domain_names" {
  description = "Custom domain names that serve this API."
  type        = list(string)
  default     = []
}

variable "certificate_arn" {
  description = "ARN of the issued regional ACM certificate covering domain_names. Only used when enable_custom_domains is true."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  description = "Retention of the API access logs in CloudWatch Logs."
  type        = number
  default     = 30
}

variable "tags" {
  description = "Tags applied to all resources created by the module."
  type        = map(string)
  default     = {}
}
