import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {isLookupCodeValid} from '../lib/validation.mjs';
import {errorResponse, json} from '../lib/http.mjs';
import {getTableName} from '../lib/config.mjs';
import {requireApiKey} from '../lib/auth.mjs';
import {docClient} from '../lib/dynamodb.mjs';


/**
 * GET /urls/{shortCode}/stats
 */
export const handler = async (event) => {
  const denied = requireApiKey(event);
  if (denied) return denied;

  const shortCode = event.pathParameters?.shortCode;
  if (!isLookupCodeValid(shortCode)) {
    return errorResponse(404, 'URL not found');
  }

  try {
    const {Item} = await docClient.send(
      new GetCommand({
        TableName: getTableName(),
        Key: {shortCode},
        // Read-after-write: a click that just happened shows up immediately.
        ConsistentRead: true,
      }),
    );

    if (!Item) {
      return errorResponse(404, 'URL not found');
    }

    return json(200, {
      shortCode: Item.shortCode,
      originalUrl: Item.originalUrl,
      clicks: Item.clicks || 0,
      createdAt: Item.createdAt,
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    return errorResponse(500, 'Internal server error');
  }
};
