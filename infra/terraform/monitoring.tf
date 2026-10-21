# Optional alarms: created only when alarm_email is set.

resource "aws_sns_topic" "alarms" {
  count = local.alarms_enabled ? 1 : 0

  name = "${local.name_prefix}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count = local.alarms_enabled ? 1 : 0

  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = local.alarms_enabled ? local.functions : {}

  alarm_name          = "${local.name_prefix}-${each.key}-errors"
  alarm_description   = "Unhandled errors in the ${local.name_prefix}-${each.key} Lambda function"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]

  dimensions = {
    FunctionName = aws_lambda_function.this[each.key].function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  for_each = local.alarms_enabled ? {
    redirect   = module.redirect_api.api_id
    management = module.management_api.api_id
  } : {}

  alarm_name          = "${local.name_prefix}-${each.key}-api-5xx"
  alarm_description   = "Server errors returned by the ${each.key} API"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]

  dimensions = {
    ApiId = each.value
  }
}
