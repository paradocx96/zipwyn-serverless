import {ScanCommand} from '@aws-sdk/lib-dynamodb';
import {decodeCursor, encodeCursor, parseLimit} from '../lib/pagination.mjs';
import {getBaseUrl, getTableName} from '../lib/config.mjs';
import {errorResponse, json} from '../lib/http.mjs';
import {requireApiKey} from '../lib/auth.mjs';
import {docClient} from '../lib/dynamodb.mjs';


/**
 * GET /urls?limit=50&cursor=<token>
 */
export const handler = async (event) => {
  const denied = requireApiKey(event);
  if (denied) return denied;

  const {limit: rawLimit, cursor} = event.queryStringParameters ?? {};

  const limit = parseLimit(rawLimit);
  if (limit === null) {
    return errorResponse(400, 'limit must be a positive integer');
  }

  let exclusiveStartKey;
  if (cursor) {
    exclusiveStartKey = decodeCursor(cursor);
    if (!exclusiveStartKey) {
      return errorResponse(400, 'Invalid cursor');
    }
  }

  try {
    const baseUrl = getBaseUrl(event);
    const result = await docClient.send(
      new ScanCommand({
        TableName: getTableName(),
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );

    const response = {
      urls: (result.Items ?? []).map((item) => ({
        shortCode: item.shortCode,
        shortUrl: `${baseUrl}/${item.shortCode}`,
        originalUrl: item.originalUrl,
        clicks: item.clicks || 0,
        createdAt: item.createdAt,
      })),
    };

    if (result.LastEvaluatedKey) {
      response.nextCursor = encodeCursor(result.LastEvaluatedKey);
    }

    return json(200, response);
  } catch (error) {
    console.error('Error listing links:', error);
    return errorResponse(500, 'Internal server error');
  }
};
