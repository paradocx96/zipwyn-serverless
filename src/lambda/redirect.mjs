import {GetCommand, UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {notFoundPage, serverErrorPage} from '../lib/http.mjs';
import {isLookupCodeValid} from '../lib/validation.mjs';
import {getTableName} from '../lib/config.mjs';
import {docClient} from '../lib/dynamodb.mjs';


// Browsers request these automatically; answer without touching DynamoDB.
const IGNORED_PATHS = new Set(['favicon.ico', 'robots.txt']);

const isConditionalFailure = (error) => error?.name === 'ConditionalCheckFailedException';

const redirectTo = (location) => ({
  statusCode: 302,
  headers: {
    Location: location,
    // Never cache the redirect, so every visit reaches this function and is counted.
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  },
});

/**
 * Last-resort lookup used when the click counter update fails for a reason
 * other than "link does not exist" (for example throttling). Keeps links
 * working even if the click could not be counted.
 */
const lookupWithoutCounting = async (shortCode) => {
  const {Item} = await docClient.send(
    new GetCommand({TableName: getTableName(), Key: {shortCode}}),
  );
  return Item?.originalUrl;
};

/**
 * GET /{shortCode}
 *
 * A single conditional UpdateItem increments the click counter *and* returns
 * the destination atomically: one round trip, no lost counts, and no phantom
 * items created for unknown codes.
 */
export const handler = async (event) => {
  const shortCode = event.pathParameters?.shortCode;

  if (IGNORED_PATHS.has(shortCode)) {
    return {statusCode: 404, headers: {'Cache-Control': 'public, max-age=86400'}};
  }
  if (!isLookupCodeValid(shortCode)) {
    return notFoundPage();
  }

  try {
    const {Attributes} = await docClient.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: {shortCode},
        UpdateExpression: 'SET clicks = if_not_exists(clicks, :zero) + :inc',
        ConditionExpression: 'attribute_exists(shortCode)',
        ExpressionAttributeValues: {':inc': 1, ':zero': 0},
        ReturnValues: 'ALL_NEW',
      }),
    );

    return Attributes?.originalUrl ? redirectTo(Attributes.originalUrl) : notFoundPage();
  } catch (error) {
    if (isConditionalFailure(error)) {
      return notFoundPage();
    }

    console.error('Failed to record click, falling back to plain lookup:', error);
    try {
      const destination = await lookupWithoutCounting(shortCode);
      return destination ? redirectTo(destination) : notFoundPage();
    } catch (fallbackError) {
      console.error('Error redirecting:', fallbackError);
      return serverErrorPage();
    }
  }
};
