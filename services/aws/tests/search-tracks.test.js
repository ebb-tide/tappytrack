const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const root = resolve(__dirname, '..');
const response = items => ({ ok: true, status: 200, json: async () => ({ tracks: { items } }) });
const tokenResponse = { ok: true, status: 200, json: async () => ({
  access_token: 'new-access', refresh_token: 'rotated-refresh', expires_in: 3600,
}) };

function setup({ user = { accessToken: 'access' }, responses = [response([])], databaseError } = {}) {
  const calls = [];
  const writes = [];
  const signals = [];
  const reads = [];
  const context = {
    exports: {}, URLSearchParams, Date,
    process: { env: { INTERNAL_SECRET: 'secret', USERS_TABLE: 'users' } },
    AbortSignal: { timeout(ms) {
      assert.equal(ms, 4000);
      const controller = new AbortController();
      signals.push(controller);
      return controller.signal;
    } },
    fetch: async (url, options) => {
      assert.equal(options.signal, signals[0].signal);
      calls.push({ url, options });
      const next = responses[calls.length - 1];
      if (next instanceof Error) throw next;
      if (typeof next === 'function') return next(signals[0]);
      assert.ok(next, 'unexpected network request');
      return next;
    },
    require(name) {
      if (name === '/opt/spotify-token') {
        const nested = { ...context, module: { exports: {} } };
        vm.runInNewContext(readFileSync(resolve(root, 'layers/spotify/spotify-token.js'), 'utf8'), nested);
        return nested.module.exports;
      }
      if (name === '@aws-sdk/client-dynamodb') return {
        DynamoDBClient: class { constructor(options) { assert.equal(options.maxAttempts, 1); } },
      };
      if (name === '@aws-sdk/lib-dynamodb') return {
        GetCommand: class { constructor(input) { this.input = input; } },
        UpdateCommand: class { constructor(input) { this.input = input; } },
        DynamoDBDocumentClient: { from: () => ({ send: async (command, options) => {
          assert.equal(options.abortSignal, signals[0].signal);
          if (databaseError) throw databaseError;
          if (command.input.UpdateExpression) { writes.push(command.input); return {}; }
          reads.push(command.input);
          return { Item: user };
        } }) },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  vm.runInNewContext(readFileSync(resolve(root, 'lambdas/searchTracks/index.js'), 'utf8'), context);
  return { calls, writes, reads, signals, run: (overrides = {}) => context.exports.handler({
    headers: { 'x-internal': 'secret' }, queryStringParameters: { userid: 'u', q: 'song artist' }, ...overrides,
  }) };
}

test('searches tracks with an encoded query and returns only picker fields', async () => {
  const track = { id: 'abc', name: 'Song', artists: [{ name: 'Artist' }, { name: 'Guest' }],
    album: { name: 'Album', images: [{ url: 'https://i.scdn.co/art.jpg' }] },
    external_urls: { spotify: 'https://open.spotify.com/track/abc' }, secret: 'ignored' };
  const app = setup({ responses: [response([track, track, null])] });
  const result = await app.run({ queryStringParameters: { userid: 'u', q: 'Björk & friends' } });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { tracks: [{ id: 'abc', name: 'Song', artistName: 'Artist, Guest',
    albumName: 'Album', imageUrl: 'https://i.scdn.co/art.jpg', spotifyUrl: 'https://open.spotify.com/track/abc' }] });
  const url = new URL(app.calls[0].url);
  assert.equal(url.searchParams.get('q'), 'Björk & friends');
  assert.equal(url.searchParams.get('type'), 'track');
  assert.equal(url.searchParams.get('limit'), '5');
  assert.equal(app.calls[0].options.headers.Authorization, 'Bearer access');
  assert.doesNotMatch(result.body, /access|secret/);
});

test('rejects unauthorized or invalid searches without contacting the database or Spotify', async () => {
  const app = setup();
  assert.equal((await app.run({ headers: {} })).statusCode, 403);
  for (const params of [{}, { userid: 'u', q: 'a' }, { userid: 'u', q: ' '.repeat(3) }, { userid: 'u', q: 'x'.repeat(121) }]) {
    assert.equal((await app.run({ queryStringParameters: params })).statusCode, 400);
  }
  assert.equal(app.reads.length, 0);
  assert.equal(app.calls.length, 0);
});

test('missing users and disconnected accounts receive actionable errors', async () => {
  assert.equal((await setup({ user: null }).run()).statusCode, 404);
  const app = setup({ user: {} });
  const result = await app.run();
  assert.equal(result.statusCode, 401);
  assert.match(JSON.parse(result.body).error, /Reconnect Spotify/);
  assert.equal(app.calls.length, 0);
});

test('empty searches and tracks without artwork are supported', async () => {
  assert.deepEqual(JSON.parse((await setup().run()).body), { tracks: [] });
  const app = setup({ responses: [response([{ id: 'abc', name: 'Song', artists: [] }])] });
  const track = JSON.parse((await app.run()).body).tracks[0];
  assert.equal(track.imageUrl, null);
  assert.equal(track.spotifyUrl, 'https://open.spotify.com/track/abc');
});

for (const proactive of [true, false]) {
  test(`${proactive ? 'expired token' : 'Spotify 401'} refresh persists rotation before searching again`, async () => {
    const app = setup({
      user: { accessToken: 'old', refreshToken: 'refresh', ...(proactive ? { expiresAt: 1 } : {}) },
      responses: [...(proactive ? [] : [{ status: 401 }]), tokenResponse, response([])],
    });
    assert.equal((await app.run()).statusCode, 200);
    assert.equal(app.writes.length, 1);
    assert.equal(app.writes[0].ExpressionAttributeValues[':rt'], 'rotated-refresh');
    assert.equal(app.calls.at(-1).options.headers.Authorization, 'Bearer new-access');
  });
}

test('a second 401 stops refresh recovery', async () => {
  const app = setup({ user: { accessToken: 'old', refreshToken: 'refresh' },
    responses: [{ status: 401 }, tokenResponse, { status: 401 }] });
  assert.equal((await app.run()).statusCode, 401);
  assert.equal(app.calls.length, 3);
});

test('rate limits preserve Retry-After and never retry immediately', async () => {
  const app = setup({ responses: [{ status: 429, headers: { get: () => '12' } }] });
  const result = await app.run();
  assert.equal(result.statusCode, 429);
  assert.equal(JSON.parse(result.body).retryAfter, 12);
  assert.equal(app.calls.length, 1);
});

test('Spotify access errors remain errors, not empty results', async () => {
  assert.equal((await setup({ responses: [{ status: 403 }] }).run()).statusCode, 403);
  assert.equal((await setup({ responses: [{ status: 500 }] }).run()).statusCode, 502);
});

test('stalled requests and response bodies return a timeout', async () => {
  const stall = controller => new Promise((resolve, reject) => {
    controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    queueMicrotask(() => controller.abort());
  });
  assert.equal((await setup({ responses: [stall] }).run()).statusCode, 504);
  assert.equal((await setup({ responses: [controller => ({ ok: true, json: () => stall(controller) })] }).run()).statusCode, 504);
});

test('database and refresh failures do not leak credentials', async () => {
  for (const app of [setup({ databaseError: new Error('private access token') }),
    setup({ user: { refreshToken: 'private', expiresAt: 1 }, responses: [{ ok: false }] })]) {
    const result = await app.run();
    assert.equal(result.statusCode, 502);
    assert.doesNotMatch(result.body, /private/);
  }
});
