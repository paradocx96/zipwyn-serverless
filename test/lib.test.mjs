import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {isLookupCodeValid, validateCustomCode, validateTargetUrl} from '../src/lib/validation.mjs';
import {decodeCursor, encodeCursor, parseLimit} from '../src/lib/pagination.mjs';
import {generateShortCode} from '../src/lib/shortcode.mjs';
import './helpers.mjs';


describe('generateShortCode', () => {
  it('creates 7 URL-safe characters by default', () => {
    for (let i = 0; i < 200; i += 1) {
      assert.match(generateShortCode(), /^[A-Za-z0-9]{7}$/);
    }
  });

  it('does not repeat in a small sample', () => {
    const codes = new Set(Array.from({length: 500}, () => generateShortCode()));
    assert.equal(codes.size, 500);
  });
});

describe('validateTargetUrl', () => {
  it('accepts and normalizes http(s) URLs', () => {
    assert.deepEqual(validateTargetUrl(' https://example.com '), {url: 'https://example.com/'});
    assert.deepEqual(validateTargetUrl('http://example.com/a?b=1'), {url: 'http://example.com/a?b=1'});
  });

  it('rejects missing and non-string values', () => {
    for (const value of [undefined, null, '', '   ', 42, {}]) {
      assert.equal(validateTargetUrl(value).error, 'URL is required');
    }
  });

  it('rejects malformed URLs', () => {
    assert.equal(validateTargetUrl('not a url').error, 'Invalid URL format');
  });

  it('rejects non-http schemes', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'ftp://example.com']) {
      assert.equal(validateTargetUrl(value).error, 'Only http and https URLs are allowed');
    }
  });

  it('rejects embedded credentials', () => {
    assert.match(validateTargetUrl('https://user:pass@example.com').error, /credentials/);
  });

  it('rejects overly long URLs', () => {
    assert.match(validateTargetUrl(`https://example.com/${'a'.repeat(2100)}`).error, /at most/);
  });

  it('rejects blocked hosts, matching on host and port', () => {
    const options = {blockedHosts: ['zip.example.test', 'localhost:3001']};
    assert.match(validateTargetUrl('https://ZIP.example.test/abc', options).error, /Zipwyn/);
    assert.match(validateTargetUrl('http://localhost:3001/abc', options).error, /Zipwyn/);
    assert.ok(validateTargetUrl('http://localhost:3000/app', options).url);
  });
});

describe('validateCustomCode', () => {
  it('accepts 3-32 URL-safe characters', () => {
    for (const code of ['abc', 'my-link_1', 'A'.repeat(32)]) {
      assert.deepEqual(validateCustomCode(code), {code});
    }
  });

  it('rejects bad formats', () => {
    for (const code of ['ab', 'A'.repeat(33), 'has space', 'slash/inside', 'dot.dot', '', 5, null]) {
      assert.ok(validateCustomCode(code).error, `expected ${String(code)} to be rejected`);
    }
  });

  it('rejects reserved words case-insensitively', () => {
    assert.equal(validateCustomCode('URLS').error, 'This custom code is reserved');
    assert.equal(validateCustomCode('api').error, 'This custom code is reserved');
  });
});

describe('isLookupCodeValid', () => {
  it('is lenient for legacy codes but bounded', () => {
    assert.equal(isLookupCodeValid('abc1234'), true);
    assert.equal(isLookupCodeValid('legacy.code+1'), true);
    assert.equal(isLookupCodeValid(''), false);
    assert.equal(isLookupCodeValid(undefined), false);
    assert.equal(isLookupCodeValid('x'.repeat(129)), false);
  });
});

describe('pagination helpers', () => {
  it('parses limits', () => {
    assert.equal(parseLimit(undefined), 50);
    assert.equal(parseLimit('10'), 10);
    assert.equal(parseLimit('5000'), 100);
    for (const bad of ['0', '-1', 'abc', '1.5']) assert.equal(parseLimit(bad), null);
  });

  it('round-trips cursors and only keeps the key attribute', () => {
    const cursor = encodeCursor({shortCode: 'abc1234'});
    assert.deepEqual(decodeCursor(cursor), {shortCode: 'abc1234'});

    const crafted = Buffer.from(JSON.stringify({shortCode: 'x', other: {S: 'y'}})).toString('base64url');
    assert.deepEqual(decodeCursor(crafted), {shortCode: 'x'});
  });

  it('accepts legacy standard-base64 cursors', () => {
    const legacy = Buffer.from(JSON.stringify({shortCode: 'docs'})).toString('base64');
    assert.deepEqual(decodeCursor(legacy), {shortCode: 'docs'});
  });

  it('rejects garbage cursors', () => {
    for (const bad of ['%%%', Buffer.from('nope').toString('base64url'), Buffer.from('{"a":1}').toString('base64url')]) {
      assert.equal(decodeCursor(bad), null);
    }
  });
});
