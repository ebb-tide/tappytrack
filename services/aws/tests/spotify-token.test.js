const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

function setup(fetch) {
  const context = {
    module: { exports: {} }, fetch, URLSearchParams,
    process: { env: { USERS_TABLE: 'users', SPOTIFY_CLIENT_ID: 'client', SPOTIFY_CLIENT_SECRET: 'secret' } },
    require(name) {
      assert.equal(name, '@aws-sdk/lib-dynamodb');
      return { UpdateCommand: class { constructor(input) { this.input = input; } } };
    },
  };
  vm.runInNewContext(readFileSync(resolve(__dirname, '../layers/spotify/spotify-token.js'), 'utf8'), context);
  return context.module.exports.refreshSpotifyToken;
}

test('refreshed credentials are returned only after the rotated token is saved', async () => {
  const refresh = setup(async (_, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('grant_type'), 'refresh_token');
    assert.equal(options.body.get('client_id'), 'client');
    assert.equal(options.body.get('client_secret'), 'secret');
    return { ok: true, json: async () => ({ access_token: 'access', refresh_token: 'rotated', expires_in: 3600 }) };
  });
  let finishWrite;
  const pendingWrite = new Promise(resolve => { finishWrite = resolve; });
  let returned = false;
  const result = refresh({ send: async command => {
    assert.equal(command.input.ExpressionAttributeValues[':rt'], 'rotated');
    await pendingWrite;
  } }, 'user', 'original').then(tokens => { returned = true; return tokens; });
  // Let the request and response parsing finish while persistence remains pending.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(returned, false);
  finishWrite();
  assert.equal((await result).refreshToken, 'rotated');
});

test('a rejected refresh never writes credentials', async () => {
  const refresh = setup(async () => ({ ok: false, status: 400 }));
  await assert.rejects(refresh({ send: () => assert.fail('unexpected database write') }, 'user', 'original'),
    /Failed to refresh Spotify token/);
});

test('a failed token write propagates to the caller', async () => {
  const refresh = setup(async () => ({
    ok: true, json: async () => ({ access_token: 'access', refresh_token: 'rotated', expires_in: 3600 }),
  }));
  const failure = new Error('database unavailable');
  await assert.rejects(refresh({ send: async () => { throw failure; } }, 'user', 'original'),
    error => error === failure);
});
