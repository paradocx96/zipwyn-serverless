# One regional certificate covering every public hostname.
# DNS is managed manually at Name.com, so validation is a two-step process:
#   1. apply with enable_custom_domains = false  -> certificate requested
#   2. add the CNAMEs from the `acm_validation_records` output at Name.com
#   3. apply with enable_custom_domains = true   -> waits for ISSUED, creates domains

resource "aws_acm_certificate" "this" {
  domain_name               = local.certificate_domains[0]
  subject_alternative_names = slice(local.certificate_domains, 1, length(local.certificate_domains))
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Without validation_record_fqdns this simply waits until ACM reports ISSUED.
resource "aws_acm_certificate_validation" "this" {
  count = var.enable_custom_domains ? 1 : 0

  certificate_arn = aws_acm_certificate.this.arn

  timeouts {
    create = "45m"
  }
}
