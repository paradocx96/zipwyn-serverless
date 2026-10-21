output "api_id" {
  description = "ID of the HTTP API."
  value       = aws_apigatewayv2_api.this.id
}

output "api_endpoint" {
  description = "Default (execute-api) endpoint of the API."
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "custom_domain_targets" {
  description = "Map of custom domain name => API Gateway regional domain name to point a DNS CNAME at. Empty until enable_custom_domains is true."
  value = {
    for domain, resource in aws_apigatewayv2_domain_name.this :
    domain => resource.domain_name_configuration[0].target_domain_name
  }
}
