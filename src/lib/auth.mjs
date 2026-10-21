import {createHash, timingSafeEqual} from 'node:crypto';
import {errorResponse} from './http.mjs';

const digest = (value) => createHash('sha256').update(value).digest();

/**
 * Optional shared-secret protection for the management API
 * (create / list / stats).
 *
 * When the MANAGEMENT_API_KEY environment variable is set, requests must send
 * the same value in the `x-api-key` header. When it is unset the check is
 * skipped, which keeps local development friction-free.
 *
 * @returns an HTTP response to return immediately, or `null` if the request may proceed.
 */
export const requireApiKey = (event) => {
  const expected = process.env.MANAGEMENT_API_KEY;
  if (!expected) return null;

  // HTTP API payload v2.0 lower-cases header names.
  const provided = event.headers?.['x-api-key'];
  if (typeof provided === 'string' && timingSafeEqual(digest(provided), digest(expected))) {
    return null;
  }
  return errorResponse(401, 'Unauthorized');
};
