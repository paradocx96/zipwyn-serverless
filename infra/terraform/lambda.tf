locals {
  # One entry per Lambda function. `api` decides which API Gateway serves it and `dynamodb_actions` is its entire
  # data-plane permission set.
  functions = {
    create-url = {
      description      = "Zipwyn: create a short link"
      handler          = "lambda/createUrl.handler"
      timeout          = 10
      api              = "management"
      route            = "POST /urls"
      dynamodb_actions = ["dynamodb:PutItem"]
      needs_base_url   = true
      protected        = true
    }
    list-urls = {
      description      = "Zipwyn: list short links"
      handler          = "lambda/listUrls.handler"
      timeout          = 10
      api              = "management"
      route            = "GET /urls"
      dynamodb_actions = ["dynamodb:Scan"]
      needs_base_url   = true
      protected        = true
    }
    get-stats = {
      description      = "Zipwyn: link statistics"
      handler          = "lambda/getStats.handler"
      timeout          = 10
      api              = "management"
      route            = "GET /urls/{shortCode}/stats"
      dynamodb_actions = ["dynamodb:GetItem"]
      needs_base_url   = false
      protected        = true
    }
    redirect = {
      description = "Zipwyn: resolve a short code and redirect"
      handler     = "lambda/redirect.handler"
      timeout     = 5
      api         = "redirect"
      route       = "GET /{shortCode}"
      # UpdateItem counts the click and returns the destination; GetItem is the fallback lookup.
      dynamodb_actions = ["dynamodb:UpdateItem", "dynamodb:GetItem"]
      needs_base_url   = false
      protected        = false
    }
  }
}

# All functions share one deployment package built from ./src.
# The AWS SDK v3 is provided by the Lambda runtime, so nothing needs to be bundled.
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../src"
  output_path = "${path.module}/zipwyn-lambda.zip"
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each = local.functions

  name              = "/aws/lambda/${local.name_prefix}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "this" {
  for_each = local.functions

  function_name    = "${local.name_prefix}-${each.key}"
  description      = each.value.description
  role             = aws_iam_role.lambda[each.key].arn
  runtime          = var.lambda_runtime
  architectures    = [var.lambda_architecture]
  handler          = each.value.handler
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  memory_size      = var.lambda_memory_size
  timeout          = each.value.timeout

  environment {
    variables = merge(
      { URLS_TABLE = aws_dynamodb_table.urls.name },
      each.value.needs_base_url ? { BASE_URL = local.base_url } : {},
      each.value.protected && local.api_key_enabled ? { MANAGEMENT_API_KEY = var.management_api_key } : {},
    )
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.lambda[each.key].name
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda,
    aws_iam_role_policy.logs,
    aws_iam_role_policy.dynamodb,
  ]
}
