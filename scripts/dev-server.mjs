#!/usr/bin/env node
/**
 * Zipwyn local development server.
 *
 * Runs the *same* Lambda handlers that ship to AWS behind a tiny HTTP server
 * that emulates API Gateway (HTTP API, payload format 2.0), including CORS,
 * against DynamoDB Local. No AWS account or credentials are needed.
 *
 *   pnpm run db:start   # start DynamoDB Local (Docker)
 *   pnpm run dev        # start this server on http://localhost:3001
 *
 * Production splits these routes across two API Gateways / domains
 * (management API and redirect API); locally everything is on one origin.
 */
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env if present. Variables already set in the shell take precedence.
try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const env = process.env;
env.PORT ??= '3001';
env.AWS_REGION ??= env.AWS_DEFAULT_REGION ?? 'ap-southeast-1';
env.URLS_TABLE ??= 'zipwyn-urls';
env.BASE_URL ??= `http://localhost:${env.PORT}`;
env.DYNAMODB_ENDPOINT ??= 'http://localhost:8000';
env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000,http://127.0.0.1:3000';
if (env.DYNAMODB_ENDPOINT) {
  // DynamoDB Local accepts any credentials but the SDK insists on having some.
  env.AWS_ACCESS_KEY_ID ??= 'local';
  env.AWS_SECRET_ACCESS_KEY ??= 'local';
}

const PORT = Number(env.PORT);
const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Handlers read their configuration from the environment, so they must be
// imported only after the defaults above have been applied.
const loadHandler = async (name) =>
  (await import(pathToFileURL(resolve(ROOT, 'src/lambda', `${name}.mjs`)).href)).handler;

// Order matters: like API Gateway, the literal /urls routes win over /{shortCode}.
const routes = [
  {method: 'POST', pattern: /^\/urls$/, routeKey: 'POST /urls', handler: 'createUrl', params: []},
  {method: 'GET', pattern: /^\/urls$/, routeKey: 'GET /urls', handler: 'listUrls', params: []},
  {
    method: 'GET',
    pattern: /^\/urls\/([^/]+)\/stats$/,
    routeKey: 'GET /urls/{shortCode}/stats',
    handler: 'getStats',
    params: ['shortCode'],
  },
  {
    method: 'GET',
    pattern: /^\/([^/]+)$/,
    routeKey: 'GET /{shortCode}',
    handler: 'redirect',
    params: ['shortCode'],
  },
];

const handlers = {};
for (const name of new Set(routes.map((route) => route.handler))) {
  handlers[name] = await loadHandler(name);
}

const corsHeaders = (req) => {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (!allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) return {};
  return {'Access-Control-Allow-Origin': origin, Vary: 'Origin'};
};

const readBody = (req) =>
  new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 6 * 1024 * 1024) {
        reject(Object.assign(new Error('Payload too large'), {statusCode: 413}));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const buildEvent = (req, url, route, match, body) => {
  const now = new Date();
  const query = Object.fromEntries(url.searchParams);
  return {
    version: '2.0',
    routeKey: route.routeKey,
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value]),
    ),
    queryStringParameters: Object.keys(query).length > 0 ? query : undefined,
    pathParameters: route.params.length
      ? Object.fromEntries(route.params.map((name, i) => [name, decodeURIComponent(match[i + 1])]))
      : undefined,
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: req.headers.host,
      http: {
        method: req.method,
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: req.socket.remoteAddress,
        userAgent: req.headers['user-agent'],
      },
      requestId: randomUUID(),
      routeKey: route.routeKey,
      stage: '$default',
      time: now.toISOString(),
      timeEpoch: now.getTime(),
    },
    body: body || undefined,
    isBase64Encoded: false,
  };
};

const send = (res, statusCode, headers = {}, body) => {
  res.writeHead(statusCode, headers);
  res.end(body);
};

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const cors = corsHeaders(req);
  let status = 500;

  try {
    // CORS preflight, answered like API Gateway's built-in CORS support.
    if (req.method === 'OPTIONS') {
      status = 204;
      return send(res, status, {
        ...cors,
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'content-type,x-api-key',
        'Access-Control-Max-Age': '600',
      });
    }

    let route;
    let match;
    for (const candidate of routes) {
      if (candidate.method !== req.method) continue;
      const result = candidate.pattern.exec(url.pathname);
      if (result) {
        route = candidate;
        match = result;
        break;
      }
    }

    if (!route) {
      status = 404;
      return send(res, status, {...cors, 'Content-Type': 'application/json'}, JSON.stringify({message: 'Not Found'}));
    }

    const body = req.method === 'GET' ? '' : await readBody(req);
    const result = await handlers[route.handler](buildEvent(req, url, route, match, body), {
      awsRequestId: randomUUID(),
      functionName: `zipwyn-local-${route.handler}`,
    });

    status = result?.statusCode ?? 200;
    const payload = result?.isBase64Encoded ? Buffer.from(result.body ?? '', 'base64') : result?.body;
    return send(res, status, {...cors, ...(result?.headers ?? {})}, payload);
  } catch (error) {
    console.error(error);
    status = error.statusCode ?? 500;
    return send(res, status, {...cors, 'Content-Type': 'application/json'}, JSON.stringify({message: error.message}));
  } finally {
    console.log(`${req.method} ${url.pathname}${url.search} -> ${status} (${Date.now() - started}ms)`);
  }
});

/** Creates the local table (same schema as Terraform) if it does not exist yet. */
const ensureTable = async () => {
  if (!env.DYNAMODB_ENDPOINT) return; // pointing at real AWS: never create tables from here
  const {dynamoClient} = await import(pathToFileURL(resolve(ROOT, 'src/lib/dynamodb.mjs')).href);
  const {CreateTableCommand, DescribeTableCommand} = await import('@aws-sdk/client-dynamodb');

  const attempts = 15;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await dynamoClient.send(new DescribeTableCommand({TableName: env.URLS_TABLE}));
      return;
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        await dynamoClient.send(
          new CreateTableCommand({
            TableName: env.URLS_TABLE,
            BillingMode: 'PAY_PER_REQUEST',
            AttributeDefinitions: [{AttributeName: 'shortCode', AttributeType: 'S'}],
            KeySchema: [{AttributeName: 'shortCode', KeyType: 'HASH'}],
          }),
        );
        console.log(`Created local table "${env.URLS_TABLE}"`);
        return;
      }
      if (attempt === attempts) {
        console.error(
          `\nCould not reach DynamoDB at ${env.DYNAMODB_ENDPOINT}.\n` +
          'Start DynamoDB Local first:  pnpm run db:start\n',
        );
        throw error;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
};

await ensureTable();

server.listen(PORT, () => {
  console.log(`\nZipwyn local API  http://localhost:${PORT}`);
  console.log(`  DynamoDB        ${env.DYNAMODB_ENDPOINT || '(AWS)'}  table: ${env.URLS_TABLE}`);
  console.log(`  Short links     ${env.BASE_URL}/<code>`);
  console.log(`  CORS origins    ${allowedOrigins.join(', ') || '(none)'}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
