import {GetCommand, PutCommand, UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {afterEach, beforeEach, describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {installFakeTable, makeEvent, parse} from './helpers.mjs';
import {handler as createUrl} from '../src/lambda/createUrl.mjs';
import {handler as getStats} from '../src/lambda/getStats.mjs';
import {handler as listUrls} from '../src/lambda/listUrls.mjs';
import {handler as redirect} from '../src/lambda/redirect.mjs';


const link = (shortCode, extra = {}) => ({
  shortCode,
  originalUrl: `https://example.com/${shortCode}`,
  createdAt: 1_760_000_000_000,
  clicks: 0,
  ...extra,
});

let table;
afterEach(() => {
  table?.restore();
  delete process.env.MANAGEMENT_API_KEY;
});

describe('createUrl', () => {
  beforeEach(() => {
    table = installFakeTable();
  });

  it('creates a link with a random code', async () => {
    const res = await createUrl(makeEvent({method: 'POST', body: {url: 'https://example.com/very/long'}}));
    assert.equal(res.statusCode, 201);
    const body = parse(res);
    assert.match(body.shortCode, /^[A-Za-z0-9]{7}$/);
    assert.equal(body.shortUrl, `https://zip.example.test/${body.shortCode}`);
    assert.equal(body.originalUrl, 'https://example.com/very/long');
    assert.equal(table.items.get(body.shortCode).clicks, 0);
    assert.equal(res.headers['Content-Type'], 'application/json');
  });

  it('creates a link with a custom code', async () => {
    const res = await createUrl(makeEvent({method: 'POST', body: {url: 'https://example.com', customCode: 'docs'}}));
    assert.equal(res.statusCode, 201);
    assert.equal(parse(res).shortUrl, 'https://zip.example.test/docs');
  });

  it('treats an empty customCode as "generate one"', async () => {
    const res = await createUrl(makeEvent({method: 'POST', body: {url: 'https://example.com', customCode: ''}}));
    assert.equal(res.statusCode, 201);
    assert.match(parse(res).shortCode, /^[A-Za-z0-9]{7}$/);
  });

  it('returns 409 for a taken custom code and keeps the original', async () => {
    table.restore();
    table = installFakeTable([link('docs')]);
    const res = await createUrl(makeEvent({method: 'POST', body: {url: 'https://other.example', customCode: 'docs'}}));
    assert.equal(res.statusCode, 409);
    assert.equal(table.items.get('docs').originalUrl, 'https://example.com/docs');
  });

  it('retries when a generated code collides', async () => {
    table.restore();
    table = installFakeTable([], {forceConflicts: 2});
    const res = await createUrl(makeEvent({method: 'POST', body: {url: 'https://example.com'}}));
    assert.equal(res.statusCode, 201);
    assert.equal(table.calls.filter((c) => c instanceof PutCommand).length, 3);
  });

  it('gives up with 503 after repeated collisions', async () => {
    table.restore();
    table = installFakeTable([], {forceConflicts: 99});
    const res = await createUrl(makeEvent({method: 'POST', body: {url: 'https://example.com'}}));
    assert.equal(res.statusCode, 503);
  });

  it('validates input', async () => {
    const cases = [
      [{body: undefined}, 'URL is required'],
      [{body: '{not json'}, 'Request body'],
      [{body: '[]'}, 'Request body'],
      [{body: {}}, 'URL is required'],
      [{body: {url: 'nope'}}, 'Invalid URL'],
      [{body: {url: 'javascript:alert(1)'}}, 'Only http'],
      [{body: {url: 'https://zip.example.test/abc'}}, 'Zipwyn'],
      [{body: {url: 'https://example.com', customCode: 'a b'}}, 'Custom code'],
      [{body: {url: 'https://example.com', customCode: 123}}, 'Custom code'],
    ];
    for (const [input, message] of cases) {
      const res = await createUrl(makeEvent({method: 'POST', ...input}));
      assert.equal(res.statusCode, 400, JSON.stringify(input));
      assert.match(parse(res).error, new RegExp(message));
    }
    assert.equal(table.items.size, 0);
  });

  it('decodes base64 bodies', async () => {
    const event = makeEvent({method: 'POST'});
    event.isBase64Encoded = true;
    event.body = Buffer.from(JSON.stringify({url: 'https://example.com'})).toString('base64');
    assert.equal((await createUrl(event)).statusCode, 201);
  });

  it('hides internal errors behind a generic 500', async () => {
    table.restore();
    table = installFakeTable([], {failNextWith: new Error('boom: secret detail'), failOn: PutCommand});
    const res = await createUrl(makeEvent({method: 'POST', body: {url: 'https://example.com'}}));
    assert.equal(res.statusCode, 500);
    assert.deepEqual(parse(res), {error: 'Internal server error'});
  });

  it('enforces MANAGEMENT_API_KEY when configured', async () => {
    process.env.MANAGEMENT_API_KEY = 's3cret';
    const body = {url: 'https://example.com'};

    assert.equal((await createUrl(makeEvent({method: 'POST', body}))).statusCode, 401);
    assert.equal((await createUrl(makeEvent({method: 'POST', body, headers: {'x-api-key': 'wrong'}}))).statusCode, 401);
    assert.equal((await createUrl(makeEvent({
      method: 'POST',
      body,
      headers: {'x-api-key': 's3cret'}
    }))).statusCode, 201);
  });
});

describe('redirect', () => {
  it('redirects and counts the click in a single DynamoDB call', async () => {
    table = installFakeTable([link('abc1234')]);
    const res = await redirect(makeEvent({pathParameters: {shortCode: 'abc1234'}}));

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.Location, 'https://example.com/abc1234');
    assert.match(res.headers['Cache-Control'], /no-store/);
    assert.equal(table.items.get('abc1234').clicks, 1);
    assert.equal(table.calls.length, 1);
    assert.ok(table.calls[0] instanceof UpdateCommand);
  });

  it('keeps counting across visits and handles legacy items without a clicks field', async () => {
    const legacy = link('old');
    delete legacy.clicks;
    table = installFakeTable([legacy]);
    await redirect(makeEvent({pathParameters: {shortCode: 'old'}}));
    await redirect(makeEvent({pathParameters: {shortCode: 'old'}}));
    assert.equal(table.items.get('old').clicks, 2);
  });

  it('returns a 404 page for unknown codes without creating items', async () => {
    table = installFakeTable();
    const res = await redirect(makeEvent({pathParameters: {shortCode: 'nope123'}}));
    assert.equal(res.statusCode, 404);
    assert.match(res.headers['Content-Type'], /text\/html/);
    assert.match(res.body, /Zipwyn/);
    assert.equal(table.items.size, 0);
  });

  it('answers favicon and robots requests without touching the database', async () => {
    table = installFakeTable();
    for (const shortCode of ['favicon.ico', 'robots.txt']) {
      const res = await redirect(makeEvent({pathParameters: {shortCode}}));
      assert.equal(res.statusCode, 404);
    }
    assert.equal(table.calls.length, 0);
  });

  it('rejects missing or oversized codes without touching the database', async () => {
    table = installFakeTable();
    assert.equal((await redirect(makeEvent({}))).statusCode, 404);
    assert.equal((await redirect(makeEvent({pathParameters: {shortCode: 'x'.repeat(200)}}))).statusCode, 404);
    assert.equal(table.calls.length, 0);
  });

  it('still redirects if the click cannot be recorded', async () => {
    const throttled = Object.assign(new Error('throttled'), {name: 'ProvisionedThroughputExceededException'});
    table = installFakeTable([link('abc1234')], {failNextWith: throttled, failOn: UpdateCommand});
    const res = await redirect(makeEvent({pathParameters: {shortCode: 'abc1234'}}));
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.Location, 'https://example.com/abc1234');
    assert.ok(table.calls.some((c) => c instanceof GetCommand));
  });

  it('returns a 500 page when DynamoDB is completely unavailable', async () => {
    const down = new Error('down');
    table = installFakeTable([link('abc1234')], {failNextWith: down, failOn: UpdateCommand});
    const original = table.restore;
    // Make the fallback lookup fail too.
    const {docClient} = await import('../src/lib/dynamodb.mjs');
    const send = docClient.send;
    docClient.send = async (command) => {
      if (command instanceof GetCommand) throw down;
      return send(command);
    };
    const res = await redirect(makeEvent({pathParameters: {shortCode: 'abc1234'}}));
    docClient.send = send;
    original();
    assert.equal(res.statusCode, 500);
    assert.match(res.body, /Zipwyn/);
  });
});

describe('getStats', () => {
  it('returns link details', async () => {
    table = installFakeTable([link('abc1234', {clicks: 12})]);
    const res = await getStats(makeEvent({pathParameters: {shortCode: 'abc1234'}}));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(parse(res), {
      shortCode: 'abc1234',
      originalUrl: 'https://example.com/abc1234',
      clicks: 12,
      createdAt: 1_760_000_000_000,
    });
    assert.equal(table.calls[0].input.ConsistentRead, true);
  });

  it('returns 404 for unknown codes', async () => {
    table = installFakeTable();
    const res = await getStats(makeEvent({pathParameters: {shortCode: 'nope123'}}));
    assert.equal(res.statusCode, 404);
  });

  it('requires the API key when configured', async () => {
    table = installFakeTable([link('abc1234')]);
    process.env.MANAGEMENT_API_KEY = 'k';
    assert.equal((await getStats(makeEvent({pathParameters: {shortCode: 'abc1234'}}))).statusCode, 401);
    const ok = await getStats(makeEvent({pathParameters: {shortCode: 'abc1234'}, headers: {'x-api-key': 'k'}}));
    assert.equal(ok.statusCode, 200);
  });
});

describe('listUrls', () => {
  const seed = () => ['aaa', 'bbb', 'ccc', 'ddd', 'eee'].map((code) => link(code, {clicks: 3}));

  it('lists links with short URLs', async () => {
    table = installFakeTable(seed());
    const res = await listUrls(makeEvent());
    assert.equal(res.statusCode, 200);
    const body = parse(res);
    assert.equal(body.urls.length, 5);
    assert.equal(body.urls[0].shortUrl, 'https://zip.example.test/aaa');
    assert.equal(body.nextCursor, undefined);
  });

  it('paginates with an opaque cursor', async () => {
    table = installFakeTable(seed());
    const first = parse(await listUrls(makeEvent({query: {limit: '2'}})));
    assert.deepEqual(first.urls.map((u) => u.shortCode), ['aaa', 'bbb']);
    assert.ok(first.nextCursor);

    const second = parse(await listUrls(makeEvent({query: {limit: '2', cursor: first.nextCursor}})));
    assert.deepEqual(second.urls.map((u) => u.shortCode), ['ccc', 'ddd']);

    const third = parse(await listUrls(makeEvent({query: {limit: '2', cursor: second.nextCursor}})));
    assert.deepEqual(third.urls.map((u) => u.shortCode), ['eee']);
    assert.equal(third.nextCursor, undefined);
  });

  it('rejects invalid limit and cursor values', async () => {
    table = installFakeTable(seed());
    assert.equal((await listUrls(makeEvent({query: {limit: 'abc'}}))).statusCode, 400);
    assert.equal((await listUrls(makeEvent({query: {cursor: '%%%'}}))).statusCode, 400);
    assert.equal(table.calls.length, 0);
  });

  it('requires the API key when configured', async () => {
    table = installFakeTable(seed());
    process.env.MANAGEMENT_API_KEY = 'k';
    assert.equal((await listUrls(makeEvent())).statusCode, 401);
    assert.equal((await listUrls(makeEvent({headers: {'x-api-key': 'k'}}))).statusCode, 200);
  });
});
