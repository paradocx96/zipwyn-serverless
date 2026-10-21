output "redirect_base_url" {
  description = "Public origin of short links (the BASE_URL given to the functions)."
  value       = local.base_url
}

output "management_api_url" {
  description = "URL the Zipwyn web app should use for the management API."
  value       = "https://${local.api_domain}"
}

output "default_endpoints" {
  description = "Default execute-api endpoints. Handy for testing before DNS is ready."
  value = {
    redirect   = module.redirect_api.api_endpoint
    management = module.management_api.api_endpoint
  }
}

output "dynamodb_table_name" {
  description = "Name of the DynamoDB table."
  value       = aws_dynamodb_table.urls.name
}

output "dynamodb_users_table_name" {
  description = "Name of the DynamoDB table that stores users."
  value       = aws_dynamodb_table.users.name
}

output "dynamodb_accounts_table_name" {
  description = "Name of the DynamoDB table that stores accounts."
  value       = aws_dynamodb_table.accounts.name
}

output "lambda_function_names" {
  description = "Deployed Lambda function names."
  value       = { for key, fn in aws_lambda_function.this : key => fn.function_name }
}

output "certificate_arn" {
  description = "ARN of the ACM certificate. Check its status with: aws acm describe-certificate --certificate-arn <arn> --query Certificate.Status"
  value       = aws_acm_certificate.this.arn
}

output "acm_validation_records" {
  description = "DNS records to create at Name.com so ACM can issue the certificate. `host` is relative to root_domain."
  value = [
    for option in aws_acm_certificate.this.domain_validation_options : {
      domain = option.domain_name
      host   = trimsuffix(trimsuffix(option.resource_record_name, "."), ".${var.root_domain}")
      type   = option.resource_record_type
      value  = option.resource_record_value
    }
  ]
}

output "dns_records" {
  description = "CNAME records to create at Name.com after enable_custom_domains = true. `host` is relative to root_domain."
  value = [
    for domain, target in merge(
      module.redirect_api.custom_domain_targets,
      module.management_api.custom_domain_targets,
      ) : {
      host  = trimsuffix(domain, ".${var.root_domain}")
      type  = "CNAME"
      value = target
    }
  ]
}
