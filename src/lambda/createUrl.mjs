import {PutCommand} from '@aws-sdk/lib-dynamodb';
import {validateCustomCode, validateTargetUrl} from '../lib/validation.mjs';
import {errorResponse, json, parseJsonBody} from '../lib/http.mjs';
import {getBaseUrl, getTableName} from '../lib/config.mjs';
import {generateShortCode} from '../lib/shortcode.mjs';
import {requireApiKey} from '../lib/auth.mjs';
import {docClient} from '../lib/dynamodb.mjs';


const MAX_GENERATION_ATTEMPTS = 5;

const isConditionalFailure = (error) => error?.name === 'ConditionalCheckFailedException';

const hostOf = (origin) => {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
};

/** Inserts a link; throws ConditionalCheckFailedException if the code is taken. */
const insertLink = (item) =>
  docClient.send(
    new PutCommand({
      TableName: getTableName(),
      Item: item,
      ConditionExpression: 'attribute_not_exists(shortCode)',
    }),
  );

/**
 * POST /urls
 * Body: { "url": "https://...", "customCode": "optional-vanity-code" }
 */
export const handler = async (event) => {
  const denied = requireApiKey(event);
  if (denied) return denied;

  try {
    const body = parseJsonBody(event);
    if (!body) {
      return errorResponse(400, 'Request body must be a valid JSON object');
    }

    const baseUrl = getBaseUrl(event);
    const blockedHost = hostOf(baseUrl);
    const target = validateTargetUrl(body.url, {blockedHosts: blockedHost ? [blockedHost] : []});
    if (target.error) {
      return errorResponse(400, target.error);
    }

    const {customCode} = body;
    const wantsCustomCode = customCode !== undefined && customCode !== null && customCode !== '';

    const buildItem = (shortCode) => ({
      shortCode,
      originalUrl: target.url,
      createdAt: Date.now(),
      clicks: 0,
    });
    const created = (item) =>
      json(201, {
        shortCode: item.shortCode,
        shortUrl: `${baseUrl}/${item.shortCode}`,
        originalUrl: item.originalUrl,
        createdAt: item.createdAt,
      });

    if (wantsCustomCode) {
      const checked = validateCustomCode(customCode);
      if (checked.error) {
        return errorResponse(400, checked.error);
      }
      const item = buildItem(checked.code);
      try {
        await insertLink(item);
      } catch (error) {
        if (isConditionalFailure(error)) {
          return errorResponse(409, 'Short code already exists');
        }
        throw error;
      }
      return created(item);
    }

    // Random code: retry on the (very unlikely) collision.
    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const item = buildItem(generateShortCode());
      try {
        await insertLink(item);
        return created(item);
      } catch (error) {
        if (!isConditionalFailure(error)) throw error;
      }
    }
    return errorResponse(503, 'Could not generate a unique short code, please retry');
  } catch (error) {
    console.error('Error creating link:', error);
    return errorResponse(500, 'Internal server error');
  }
};
