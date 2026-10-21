export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/**
 * Parses the `limit` query parameter.
 * Returns the default when absent, `null` when invalid, otherwise a value
 * clamped to MAX_PAGE_SIZE.
 */
export const parseLimit = (raw) => {
  if (raw === undefined || raw === '') return DEFAULT_PAGE_SIZE;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return null;
  return Math.min(value, MAX_PAGE_SIZE);
};

/** Encodes DynamoDB's LastEvaluatedKey as an opaque URL-safe cursor. */
export const encodeCursor = (key) => Buffer.from(JSON.stringify(key)).toString('base64url');

/**
 * Decodes a cursor back into an ExclusiveStartKey.
 * Only the table's key attribute is accepted, so a crafted cursor cannot
 * inject anything else into the DynamoDB request. Returns `null` if invalid.
 */
export const decodeCursor = (cursor) => {
  try {
    const key = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (key && typeof key.shortCode === 'string' && key.shortCode.length > 0) {
      return {shortCode: key.shortCode};
    }
  } catch {
    // fall through
  }
  return null;
};
