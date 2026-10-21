# Two separate HTTP APIs keep the public, high-traffic redirect surface apart
# from the management API used by the Zipwyn web app:
#
#   redirect API    GET /{shortCode}           -> https://zip.navindalc.app
#   management API  POST|GET /urls, stats      -> https://zipwyn-api.navindalc.app

module "redirect_api" {
  source = "./modules/http-api"

  name        = "${local.name_prefix}-redirect-api"
  description = "Zipwyn public short-link redirects"

  routes = {
    for key, fn in local.functions : key => {
      route_key         = fn.route
      lambda_name       = aws_lambda_function.this[key].function_name
      lambda_invoke_arn = aws_lambda_function.this[key].invoke_arn
    } if fn.api == "redirect"
  }

  throttling_rate_limit        = var.redirect_throttle.rate
  throttling_burst_limit       = var.redirect_throttle.burst
  disable_execute_api_endpoint = var.disable_default_endpoints
  log_retention_days           = var.log_retention_days

  enable_custom_domains = var.enable_custom_domains
  domain_names          = local.redirect_domains
  certificate_arn       = var.enable_custom_domains ? aws_acm_certificate_validation.this[0].certificate_arn : ""
}

module "management_api" {
  source = "./modules/http-api"

  name        = "${local.name_prefix}-management-api"
  description = "Zipwyn management API (create, list, stats)"

  routes = {
    for key, fn in local.functions : key => {
      route_key         = fn.route
      lambda_name       = aws_lambda_function.this[key].function_name
      lambda_invoke_arn = aws_lambda_function.this[key].invoke_arn
    } if fn.api == "management"
  }

  cors = {
    allow_origins = local.cors_allowed_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["content-type", "x-api-key"]
    max_age       = 600
  }

  throttling_rate_limit        = var.management_throttle.rate
  throttling_burst_limit       = var.management_throttle.burst
  disable_execute_api_endpoint = var.disable_default_endpoints
  log_retention_days           = var.log_retention_days

  enable_custom_domains = var.enable_custom_domains
  domain_names          = [local.api_domain]
  certificate_arn       = var.enable_custom_domains ? aws_acm_certificate_validation.this[0].certificate_arn : ""
}
