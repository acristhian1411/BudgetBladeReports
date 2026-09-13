import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractScopes, getUserFromToken, loginWithLaravel } from '../src/services/laravelAuth.js';
import { requireScope } from '../src/middleware/requireScope.js';

const runMiddleware = (mw, req) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ kind: 'responded', code: this.statusCode, body });
      },
    };
    mw(req, res, () => resolve({ kind: 'next' }));
  });

test('extractScopes normalizes array, string, and nested shapes', () => {
  assert.deepEqual(extractScopes({ scopes: ['finance:sync'] }), ['finance:sync']);
  assert.deepEqual(extractScopes({ scope: 'finance:read finance:sync' }), [
    'finance:read',
    'finance:sync',
  ]);
  assert.deepEqual(extractScopes({ token: { scopes: ['finance:sync'] } }), [
    'finance:sync',
  ]);
  assert.deepEqual(extractScopes({}), []);
  assert.deepEqual(extractScopes(null), []);
});

test('requireScope allows a token with the required scope', async () => {
  const mw = requireScope('finance:sync');
  const result = await runMiddleware(mw, { authUser: { scopes: ['finance:sync'] } });
  assert.equal(result.kind, 'next');
});

test('requireScope rejects a token without the required scope', async () => {
  const mw = requireScope('finance:sync');
  const result = await runMiddleware(mw, { authUser: { scopes: ['finance:read'] } });
  assert.equal(result.kind, 'responded');
  assert.equal(result.code, 403);
});

test('requireScope allows a wildcard scope', async () => {
  const mw = requireScope('finance:sync');
  const result = await runMiddleware(mw, { authUser: { scopes: ['*'] } });
  assert.equal(result.kind, 'next');
});

test('requireScope skips enforcement when no scope is required', async () => {
  const mw = requireScope('');
  const result = await runMiddleware(mw, { authUser: {} });
  assert.equal(result.kind, 'next');
});

test('auth helpers live in the single consolidated module', () => {
  assert.equal(typeof getUserFromToken, 'function');
  assert.equal(typeof loginWithLaravel, 'function');
  assert.equal(typeof extractScopes, 'function');
});
