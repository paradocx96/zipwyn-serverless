# One role per function, each limited to exactly what that function needs.

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  for_each = local.functions

  name               = "${local.name_prefix}-${each.key}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Data access: specific DynamoDB actions on the Zipwyn table only.
resource "aws_iam_role_policy" "dynamodb" {
  for_each = local.functions

  name = "dynamodb-access"
  role = aws_iam_role.lambda[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = each.value.dynamodb_actions
      Resource = [
        aws_dynamodb_table.users.arn,
        aws_dynamodb_table.accounts.arn,
        aws_dynamodb_table.urls.arn
      ]
    }]
  })
}

# Logging: write to the function's own, pre-created log group only.
resource "aws_iam_role_policy" "logs" {
  for_each = local.functions

  name = "cloudwatch-logs"
  role = aws_iam_role.lambda[each.key].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.lambda[each.key].arn}:*"
    }]
  })
}
