locals {
  name_prefix = var.project

  # Domains -----------------------------------------------------------------
  # public short links
  redirect_domain = "${var.redirect_subdomain}.${var.root_domain}"
  # management API
  api_domain = "${var.api_subdomain}.${var.root_domain}"
  # Zipwyn web app (hosted elsewhere)
  frontend_domain = "${var.frontend_subdomain}.${var.root_domain}"

  redirect_domains    = distinct(concat([local.redirect_domain], var.redirect_extra_domains))
  certificate_domains = concat(local.redirect_domains, [local.api_domain])

  # Origin used to build the short links returned by the API.
  base_url = "https://${local.redirect_domain}"

  cors_allowed_origins = length(var.cors_allowed_origins) > 0 ? var.cors_allowed_origins : ["https://${local.frontend_domain}"]

  api_key_enabled = nonsensitive(var.management_api_key != "")
  alarms_enabled  = var.alarm_email != ""

  tags = merge(
    {
      project     = "zipwyn"
      Environment = var.environment
      ManagedBy   = "Terraform"
    },
    var.tags,
  )
}
