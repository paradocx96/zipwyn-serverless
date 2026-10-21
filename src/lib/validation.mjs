export const MAX_URL_LENGTH = 2048;

// Custom codes: 3-32 URL-safe characters.
const CUSTOM_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

// Codes that must never be handed out as vanity links.
const RESERVED_CODES = new Set(['api', 'urls', 'health', 'admin']);

/**
 * Validates the destination URL of a new link.
 * Only absolute http(s) URLs are accepted; this blocks javascript:, data:,
 * file: and similar schemes from being used as redirect targets.
 *
 * @param {unknown} value
 * @param {{ blockedHosts?: string[] }} [options] hosts (with port) that may not be shortened,
 *        used to stop Zipwyn links from pointing back at Zipwyn.
 * @returns {{ url: string } | { error: string }}
 */
export const validateTargetUrl = (value, {blockedHosts = []} = {}) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return {error: 'URL is required'};
  }

  const candidate = value.trim();
  if (candidate.length > MAX_URL_LENGTH) {
    return {error: `URL must be at most ${MAX_URL_LENGTH} characters`};
  }

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return {error: 'Invalid URL format'};
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {error: 'Only http and https URLs are allowed'};
  }
  if (parsed.username || parsed.password) {
    return {error: 'URLs containing credentials are not allowed'};
  }
  if (blockedHosts.includes(parsed.host.toLowerCase())) {
    return {error: 'Zipwyn links cannot point to Zipwyn itself'};
  }

  return {url: parsed.href};
};

/**
 * Validates a user-chosen short code.
 * @returns {{ code: string } | { error: string }}
 */
export const validateCustomCode = (value) => {
  if (typeof value !== 'string' || !CUSTOM_CODE_PATTERN.test(value)) {
    return {error: 'Custom code must be 3-32 characters: letters, numbers, "-" or "_"'};
  }
  if (RESERVED_CODES.has(value.toLowerCase())) {
    return {error: 'This custom code is reserved'};
  }
  return {code: value};
};

/**
 * Sanity check for the short code taken from the request path.
 * Deliberately lenient so links created before stricter rules keep working.
 */
export const isLookupCodeValid = (code) =>
  typeof code === 'string' && code.length > 0 && code.length <= 128;
