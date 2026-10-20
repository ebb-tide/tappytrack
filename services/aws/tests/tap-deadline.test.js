const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const directory = resolve(__dirname, '../lambdas/tapCard');

function setupDeadline(fetch = async () => ({})) {
  const context = { module: { exports: {} }, fetch, AbortSignal, Date };
  vm.runInNewContext(readFileSync(resolve(directory, 'deadline.js'), 'utf8'), context);
  return context.module.exports;
}

test('Spotify and database calls consume the same shrinking work budget', async () => {
  let now = 0;
  const caps = [];
  const { createDeadline } = setupDeadline(async () => { now += 1800; return {}; });
  const deadline = createDeadline(undefined, { now: () => now, signalFor: ms => { caps.push(ms); return {}; } });
  await deadline.fetch('spotify', {});
  await deadline.send({ send: async () => { now += 800; } }, {});
  await deadline.fetch('spotify', {});
  assert.deepEqual(caps, [2000, 1000, 1700]);
  await assert.rejects(deadline.fetch('spotify', {}), error => error.status === 504);
  assert.equal(caps.length, 3);
});

test('remaining Lambda time leaves 700 ms for error recording and response', async () => {
  let cap;
  const { createDeadline } = setupDeadline();
  const deadline = createDeadline({ getRemainingTimeInMillis: () => 1600 }, {
    now: () => 0, signalFor: ms => { cap = ms; return {}; },
  });
  await deadline.fetch('spotify', {});
  assert.equal(cap, 900);
});

test('token refresh can reserve a database write within the work budget', async () => {
  let now = 0;
  const caps = [];
  const { createDeadline } = setupDeadline(async () => ({}));
  const deadline = createDeadline(undefined, { now: () => now, signalFor: ms => { caps.push(ms); return {}; } });
  now = 2000;
  await deadline.fetch('token', {}, 'Spotify token refresh', 1000);
  assert.deepEqual(caps, [1300]);
  now = 3400;
  await assert.rejects(deadline.fetch('token', {}, 'Spotify token refresh', 1000), error => error.status === 504);
  assert.equal(caps.length, 1);
});

test('no network operation starts when only the response reserve remains', async () => {
  const { createDeadline } = setupDeadline(() => assert.fail('unexpected request'));
  const deadline = createDeadline({ getRemainingTimeInMillis: () => 600 });
  await assert.rejects(deadline.fetch('spotify', {}), error => error.status === 504);
});

test('a stalled Spotify fetch is cancelled and becomes a timeout response', async () => {
  const controller = new AbortController();
  const { createDeadline } = setupDeadline((_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  const deadline = createDeadline(undefined, { signalFor: () => controller.signal });
  const pending = deadline.fetch('spotify', {});
  controller.abort();
  await assert.rejects(pending, error => error.status === 504);
});

test('database calls receive an abort signal and preserve non-timeout errors', async () => {
  const signal = {};
  const failure = new Error('database denied access');
  const { createDeadline } = setupDeadline();
  const deadline = createDeadline(undefined, { signalFor: () => signal });
  await assert.rejects(deadline.send({ send: async (_, options) => {
    assert.equal(options.abortSignal, signal);
    throw failure;
  } }, {}), error => error === failure);
});

function setupTap({ deviceFetch, tokenFetch, user = {}, contextRemaining = 5000, initialNow = 0 } = {}) {
  let now = initialNow;
  const fetches = [];
  const writes = [];
  const signals = [];
  class GetCommand { constructor(input) { this.input = input; } }
  class UpdateCommand { constructor(input) { this.input = input; } }
  const context = {
    exports: {}, Buffer, URLSearchParams,
    Date: class extends Date { static now() { return now; } },
    AbortSignal: { timeout: ms => { const signal = { ms, aborted: false }; signals.push(signal); return signal; } },
    console: { log() {}, error() {} },
    process: { env: { USERS_TABLE: 'users', CARDS_TABLE: 'cards', DEVICES_TABLE: 'devices', INTERNAL_SECRET: 'secret' } },
    fetch: async (url, options) => {
      fetches.push({ url, options });
      if (url.endsWith('/token')) return tokenFetch(options);
      if (url.endsWith('/devices')) {
        return deviceFetch ? deviceFetch(options, () => { now += 4500; }) : {
          ok: true, status: 200,
          json: async () => ({ devices: [{ id: 'speaker', name: 'Speaker' }] }),
        };
      }
      return { ok: true, status: 204 };
    },
    require(name) {
      if (name === '/opt/spotify-token') {
        const nested = { ...context, module: { exports: {} } };
        vm.runInNewContext(readFileSync(resolve(directory, '../../layers/spotify/spotify-token.js'), 'utf8'), nested);
        return nested.module.exports;
      }
      if (name === './deadline') {
        const nested = { ...context, module: { exports: {} } };
        vm.runInNewContext(readFileSync(resolve(directory, 'deadline.js'), 'utf8'), nested);
        return nested.module.exports;
      }
      if (name === '/opt/notify') return { notify: async () => assert.fail('known card must not notify') };
      if (name === '@aws-sdk/client-dynamodb') return {
        DynamoDBClient: class { constructor(config) { assert.equal(config.maxAttempts, 1); } },
      };
      if (name === '@aws-sdk/lib-dynamodb') return {
        GetCommand, UpdateCommand,
        DynamoDBDocumentClient: { from: () => ({ send: async command => {
          if (command instanceof UpdateCommand) { writes.push(command.input); return {}; }
          if (command.input.TableName === 'devices') return { Item: { userid: 'u' } };
          if (command.input.TableName === 'cards') return { Item: { spotifyURL: 'https://open.spotify.com/track/abc' } };
          return { Item: { userid: 'u', accessToken: 'token', playerid: 'speaker', playerName: 'Speaker', ...user } };
        } }) },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  vm.runInNewContext(readFileSync(resolve(directory, 'index.js'), 'utf8'), context);
  return {
    fetches, writes, signals,
    run: () => context.exports.handler({ headers: { 'x-internal': 'secret' }, body: JSON.stringify({ deviceid: 'd', cardID: 'AABB' }) },
      { getRemainingTimeInMillis: () => contextRemaining }),
  };
}

test('normal tap still resolves, transfers and plays with bounded requests', async () => {
  const app = setupTap();
  assert.equal((await app.run()).statusCode, 200);
  assert.equal(app.fetches.length, 3);
  assert.ok(app.fetches.every(request => request.options.signal.ms === 2000));
});

for (const proactive of [true, false]) {
  for (const rotated of [true, false]) {
    test(`tap ${proactive ? 'expired token' : 'device 401'} refresh ${rotated ? 'persists rotated' : 'preserves original'} refresh token`, async () => {
      let deviceRequests = 0;
      const app = setupTap({
        initialNow: 10000,
        user: { refreshToken: 'original-refresh', expiresAt: proactive ? 1 : undefined },
        tokenFetch: async options => {
          assert.equal(options.body.get('refresh_token'), 'original-refresh');
          return {
            ok: true,
            json: async () => ({ access_token: 'fresh-access', expires_in: 3600,
              ...(rotated ? { refresh_token: 'rotated-refresh' } : {}) }),
          };
        },
        deviceFetch: async options => {
          if (!proactive && deviceRequests++ === 0) return { status: 401 };
          assert.equal(options.headers.Authorization, 'Bearer fresh-access');
          return { ok: true, json: async () => ({ devices: [{ id: 'speaker', name: 'Speaker' }] }) };
        },
      });
      assert.equal((await app.run()).statusCode, 200);
      const write = app.writes.find(write => ':rt' in write.ExpressionAttributeValues);
      assert.equal(write.TableName, 'users');
      assert.equal(write.Key.userid, 'u');
      assert.equal(write.ExpressionAttributeValues[':at'], 'fresh-access');
      assert.equal(write.ExpressionAttributeValues[':ea'], 3610);
      assert.equal(write.ExpressionAttributeValues[':rt'], rotated ? 'rotated-refresh' : 'original-refresh');
      assert.equal(app.fetches.at(-1).options.headers.Authorization, 'Bearer fresh-access');
    });
  }
}

test('tap recovery uses the token rotated by proactive refresh and reserves persistence time', async () => {
  const usedRefreshTokens = [];
  let deviceRequests = 0;
  const app = setupTap({
    initialNow: 10000,
    contextRemaining: 2300,
    user: { refreshToken: 'original-refresh', expiresAt: 1 },
    tokenFetch: async options => {
      usedRefreshTokens.push(options.body.get('refresh_token'));
      assert.equal(options.signal.ms, 600);
      return { ok: true, json: async () => ({
        access_token: 'fresh-access', expires_in: 3600,
        ...(usedRefreshTokens.length === 1 ? { refresh_token: 'rotated-refresh' } : {}),
      }) };
    },
    deviceFetch: async () => deviceRequests++ === 0 ? { status: 401 } : {
      ok: true, json: async () => ({ devices: [{ id: 'speaker', name: 'Speaker' }] }),
    },
  });
  assert.equal((await app.run()).statusCode, 200);
  assert.deepEqual(usedRefreshTokens, ['original-refresh', 'rotated-refresh']);
  const tokenWrites = app.writes.filter(write => ':rt' in write.ExpressionAttributeValues);
  assert.equal(tokenWrites.length, 2);
  assert.ok(tokenWrites.every(write => write.ExpressionAttributeValues[':rt'] === 'rotated-refresh'));
});

for (const bodyTimeout of [false, true]) {
  test(`Spotify ${bodyTimeout ? 'response body' : 'request'} timeout returns 504 without falling back to playback`, async () => {
    const failure = Object.assign(new Error('deadline exceeded'), { name: 'TimeoutError' });
    const app = setupTap({ deviceFetch: async () => {
      if (!bodyTimeout) throw failure;
      return { ok: true, status: 200, json: async () => { throw failure; } };
    } });
    const response = await app.run();
    assert.equal(response.statusCode, 504);
    assert.equal(app.fetches.length, 1);
    assert.match(app.writes.at(-1).ExpressionAttributeValues[':msg'], /timed out|deadline exceeded/);
    assert.equal(app.signals.at(-1).ms, 300);
  });
}

test('an exhausted tap budget stops before transfer or play', async () => {
  const app = setupTap({ deviceFetch: async (_, expire) => {
    expire();
    return { ok: true, status: 200, json: async () => ({ devices: [{ id: 'speaker', name: 'Speaker' }] }) };
  } });
  assert.equal((await app.run()).statusCode, 504);
  assert.equal(app.fetches.length, 1);
});

test('a tap invoked too close to the Lambda deadline does not touch Spotify', async () => {
  const app = setupTap({ contextRemaining: 600 });
  assert.equal((await app.run()).statusCode, 504);
  assert.equal(app.fetches.length, 0);
});
