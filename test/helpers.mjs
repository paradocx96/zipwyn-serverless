import {GetCommand, PutCommand, ScanCommand, UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {docClient} from '../src/lib/dynamodb.mjs';

process.env.URLS_TABLE = 'zipwyn-urls';
process.env.BASE_URL = 'https://zip.example.test';
delete process.env.MANAGEMENT_API_KEY;

const conditionalFailure = () =>
  Object.assign(new Error('The conditional request failed'), {name: 'ConditionalCheckFailedException'});

/**
 * Replaces `docClient.send` with an in-memory fake that understands exactly
 * the commands Zipwyn issues. Returns the backing store plus a `restore()`.
 *
 * Options:
 *  - failNextWith: throw this error from the next command of type `failOn`
 *  - forceConflicts: number of upcoming Put commands that should report a key collision
 */
export const installFakeTable = (initial = [], options = {}) => {
  const items = new Map(initial.map((item) => [item.shortCode, structuredClone(item)]));
  const calls = [];
  const original = docClient.send;
  let conflictsLeft = options.forceConflicts ?? 0;
  let failure = options.failNextWith ? {error: options.failNextWith, on: options.failOn} : null;

  docClient.send = async (command) => {
    calls.push(command);

    if (failure && command instanceof failure.on) {
      const {error} = failure;
      failure = null;
      throw error;
    }

    const input = command.input;
    if (input.TableName !== 'zipwyn-urls') {
      throw new Error(`Unexpected table ${input.TableName}`);
    }

    if (command instanceof PutCommand) {
      const exists = items.has(input.Item.shortCode);
      if (input.ConditionExpression === 'attribute_not_exists(shortCode)' && (exists || conflictsLeft > 0)) {
        if (conflictsLeft > 0) conflictsLeft -= 1;
        throw conditionalFailure();
      }
      items.set(input.Item.shortCode, structuredClone(input.Item));
      return {};
    }

    if (command instanceof GetCommand) {
      const item = items.get(input.Key.shortCode);
      return {Item: item ? structuredClone(item) : undefined};
    }

    if (command instanceof UpdateCommand) {
      const item = items.get(input.Key.shortCode);
      if (input.ConditionExpression === 'attribute_exists(shortCode)' && !item) {
        throw conditionalFailure();
      }
      item.clicks = (item.clicks ?? input.ExpressionAttributeValues[':zero']) + input.ExpressionAttributeValues[':inc'];
      return {Attributes: structuredClone(item)};
    }

    if (command instanceof ScanCommand) {
      const sorted = [...items.values()].sort((a, b) => a.shortCode.localeCompare(b.shortCode));
      const start = input.ExclusiveStartKey
        ? sorted.findIndex((item) => item.shortCode === input.ExclusiveStartKey.shortCode) + 1
        : 0;
      const page = sorted.slice(start, start + input.Limit);
      const more = start + input.Limit < sorted.length;
      return {
        Items: structuredClone(page),
        ...(more ? {LastEvaluatedKey: {shortCode: page.at(-1).shortCode}} : {}),
      };
    }

    throw new Error(`Unsupported command ${command.constructor.name}`);
  };

  return {
    items,
    calls,
    restore: () => {
      docClient.send = original;
    },
  };
};

export const makeEvent = ({method = 'GET', body, query, pathParameters, headers = {}} = {}) => ({
  version: '2.0',
  headers,
  queryStringParameters: query,
  pathParameters,
  body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  isBase64Encoded: false,
  requestContext: {domainName: 'zip.example.test', http: {method}},
});

export const parse = (response) => JSON.parse(response.body);
