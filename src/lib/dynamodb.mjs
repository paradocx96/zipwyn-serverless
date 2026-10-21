import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';

// Setting DYNAMODB_ENDPOINT (for example http://localhost:8000) points the
// client at DynamoDB Local. In AWS the variable is unset and the SDK uses the
// regional DynamoDB endpoint with the function's IAM role.
const endpoint = process.env.DYNAMODB_ENDPOINT;

export const dynamoClient = new DynamoDBClient(endpoint ? {endpoint} : {});

export const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {removeUndefinedValues: true},
});
