/**
 * Runtime configuration. Values come from environment variables so the same
 * code runs unchanged on AWS Lambda and in the local development server.
 *
 * Variables are read lazily (on every call) rather than at import time so
 * tests and the local server can set them before the first request.
 */

/** Name of the DynamoDB table that stores Zipwyn links (`zipwyn-urls`). */
export const getTableName = () => {
  const name = process.env.URLS_TABLE;
  if (!name) {
    throw new Error('URLS_TABLE environment variable is not set');
  }
  return name;
};

/**
 * Public origin used to build short links, without a trailing slash.
 * Falls back to the domain the request arrived on if BASE_URL is not set.
 */
export const getBaseUrl = (event) => {
  const configured = process.env.BASE_URL;
  const fallback = event?.requestContext?.domainName
    ? `https://${event.requestContext.domainName}`
    : '';
  return (configured || fallback).replace(/\/+$/, '');
};
