# Remote state backend.
terraform {
  backend "s3" {
    bucket       = "zipwyn-terraform-state"
    key          = "zipwyn-serverless/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
