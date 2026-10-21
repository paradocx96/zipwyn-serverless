/**
 * Small helpers for building API Gateway HTTP API (payload v2.0) responses.
 *
 * CORS is handled by API Gateway itself (see infra/terraform), so handlers
 * deliberately do not emit Access-Control-* headers.
 */

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {'Content-Type': 'application/json', ...SECURITY_HEADERS, ...headers},
  body: JSON.stringify(body),
});

export const errorResponse = (statusCode, message) => json(statusCode, {error: message});

export const html = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: {'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS, ...headers},
  body,
});

/**
 * Parses the request body as a JSON object.
 * Returns `null` when the body is missing, malformed, or not a plain object.
 */
export const parseJsonBody = (event) => {
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
      : event.body;
    const parsed = JSON.parse(raw || '{}');
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Minimal, static 404 page. It never echoes user input. */
export const notFoundPage = () =>
  html(
    404,
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Link not found | Zipwyn</title></head>' +
    '<body style="font-family:system-ui,sans-serif;text-align:center;padding:4rem 1rem">' +
    '<h1>404 &mdash; Link not found</h1>' +
    '<p>This Zipwyn link does not exist or has been removed.</p></body></html>',
  );

export const serverErrorPage = () =>
  html(
    500,
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Something went wrong | Zipwyn</title></head>' +
    '<body style="font-family:system-ui,sans-serif;text-align:center;padding:4rem 1rem">' +
    '<h1>500 &mdash; Something went wrong</h1>' +
    '<p>Please try again in a moment.</p></body></html>',
  );
