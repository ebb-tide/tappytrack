const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

function setup(fetch, send = async () => ({})) {
  const writes = [];
  const signals = [];
  const context = {
    exports: {}, Buffer, URLSearchParams, fetch,
    console: { warn() {}, error() {} },
    process: { env: { INTERNAL_SECRET: 'secret', CARDS_TABLE: 'cards', USERS_TABLE: 'users' } },
    AbortSignal: { timeout(ms) {
      const controller = new AbortController();
      signals.push({ ms, controller });
      return controller.signal;
    } },
    require(name) {
      if (name === '/opt/notify') return { notify: async () => {} };
      if (name === '@aws-sdk/client-dynamodb') return { DynamoDBClient: class {} };
      if (name === '@aws-sdk/lib-dynamodb') return {
        PutCommand: class { constructor(input) { this.input = input; } },
        UpdateCommand: class { constructor(input) { this.input = input; } },
        DynamoDBDocumentClient: { from: () => ({ send: async (command, options) => {
          writes.push(command.input);
          assert.ok(options.abortSignal);
          return send(command);
        } }) },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  vm.runInNewContext(readFileSync(resolve(__dirname, '../lambdas/addCard/index.js'), 'utf8'), context);
  return { signals, writes, run: () => context.exports.handler({
    headers: { 'x-internal': 'secret' },
    body: JSON.stringify({ userid: 'u', cardID: 'aabb', spotifyURL: 'https://open.spotify.com/track/abc' }),
  }) };
}

test('saves song details with a shared Spotify deadline', async () => {
  const app = setup(async (url, options) => {
    assert.equal(options.signal, app.signals[0].controller.signal);
    return { ok: true, json: async () => url.includes('/token')
      ? { access_token: 'token' } : { name: 'Song', artists: [{ name: 'Artist' }] } };
  });
  assert.equal((await app.run()).statusCode, 201);
  assert.equal(app.writes[0].Item.cardID, 'AABB');
  assert.equal(app.writes[0].Item.trackName, 'Song');
  assert.deepEqual(app.signals.map(s => s.ms), [1500, 1000]);
});

for (const stage of ['token', 'track', 'body']) {
  test(`still saves the card when Spotify stalls at ${stage}`, async () => {
    const stall = signal => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      queueMicrotask(() => app.signals[0].controller.abort());
    });
    const app = setup(async (url, { signal }) => {
      if (url.includes('/token')) {
        if (stage === 'token') return stall(signal);
        return { ok: true, json: async () => ({ access_token: 'token' }) };
      }
      if (stage === 'track') return stall(signal);
      return { ok: true, json: () => stall(signal) };
    });
    assert.equal((await app.run()).statusCode, 201);
    assert.equal(app.writes.length, 1);
    assert.equal(app.writes[0].Item.trackName, null);
  });
}

test('returns a failure when the card cannot be saved', async () => {
  const app = setup(async () => ({ ok: false }), async () => { throw new Error('Database unavailable'); });
  const response = await app.run();
  assert.equal(response.statusCode, 500);
  assert.match(JSON.parse(response.body).error, /Database unavailable/);
});
