import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { changeLaravelPassword } from '../src/services/laravelAuth.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

test('changeLaravelPassword forwards the token and payload to the auth server', async () => {
  let captured;
  global.fetch = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: 'Password updated.' }),
    };
  };

  const payload = {
    current_password: 'old-password',
    password: 'new-password',
    password_confirmation: 'new-password',
  };
  const result = await changeLaravelPassword('tok-123', payload);

  assert.deepEqual(result, { message: 'Password updated.' });
  assert.ok(captured.url.endsWith('/api/mobile/password'));
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.Authorization, 'Bearer tok-123');
  assert.deepEqual(JSON.parse(captured.options.body), payload);
});

test('changeLaravelPassword surfaces the first validation error from the auth server', async () => {
  global.fetch = async () => ({
    ok: false,
    status: 422,
    json: async () => ({
      message: 'The password is incorrect.',
      errors: { current_password: ['The password is incorrect.'] },
    }),
  });

  await assert.rejects(
    () => changeLaravelPassword('tok-123', {}),
    (error) => error.status === 422 && error.message === 'The password is incorrect.'
  );
});
