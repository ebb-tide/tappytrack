const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function setup(user, response) {
  const writes = [];
  const calls = [];
  class GetCommand { constructor(input) { this.input = input; } }
  class UpdateCommand { constructor(input) { this.input = input; } }
  const context = {
    exports: {},
    process: { env: { USERS_TABLE: 'users', INTERNAL_SECRET: 'test-secret' } },
    console,
    URLSearchParams,
    require(name) {
      if (name === '/opt/spotify-token') {
        const nested = { ...context, module: { exports: {} } };
        vm.runInNewContext(readFileSync(`${__dirname}/../../layers/spotify/spotify-token.js`, 'utf8'), nested);
        return nested.module.exports;
      }
      if (name === '@aws-sdk/client-dynamodb') return { DynamoDBClient: class {} };
      if (name === '@aws-sdk/lib-dynamodb') return {
        GetCommand, UpdateCommand,
        DynamoDBDocumentClient: { from: () => ({
          async send(command) {
            if (command instanceof GetCommand) return { Item: user };
            writes.push(command.input);
            return {};
          }
        }) }
      };
      throw new Error(`Unexpected module: ${name}`);
    },
    async fetch(url, options) {
      calls.push({ url, options });
      const next = Array.isArray(response) ? response[calls.length - 1] : response;
      if (!next) throw new Error('Unexpected fetch');
      return next;
    },
  };
  vm.runInNewContext(readFileSync(`${__dirname}/index.js`, 'utf8'), context);
  return {
    writes,
    calls,
    requests: () => calls.length,
    run: () => context.exports.handler({
      headers: { 'x-internal': 'test-secret' },
      queryStringParameters: { userid: 'test-user' },
    }),
  };
}

test('missing permissions gives actionable reconnect guidance and preserves status', async () => {
  const app = setup({ accessToken: 'test-token' }, {
    ok: false, status: 401,
    json: async () => ({ error: { message: 'Permissions missing' } }),
  });
  const result = await app.run();
  assert.equal(result.statusCode, 401);
  assert.match(JSON.parse(result.body).error, /permissions are missing.*Reconnect Spotify/);
  assert.equal(app.writes[0].ExpressionAttributeValues[':msg'], JSON.parse(result.body).error);
});

test('a disconnected account is an error instead of a successful empty device list', async () => {
  const app = setup({}, null);
  const result = await app.run();
  assert.equal(result.statusCode, 401);
  assert.match(JSON.parse(result.body).error, /Reconnect Spotify/);
  assert.equal(app.requests(), 0);
});

test('Spotify returning no available devices remains a successful empty list', async () => {
  const app = setup({ accessToken: 'test-token' }, {
    ok: true, status: 200, json: async () => ({ devices: [] }),
  });
  const result = await app.run();
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body).players, []);
  assert.equal(app.writes.length, 0);
});

test('Spotify device IDs and names are returned for selection', async () => {
  const devices = [{ id: 'new-iphone-id', name: 'iPhone', is_active: true }];
  const app = setup({ accessToken: 'test-token' }, {
    ok: true, status: 200, json: async () => ({ devices }),
  });
  assert.deepEqual(JSON.parse((await app.run()).body).players, devices);
});

test('rate limiting with a non-JSON response shows retry guidance', async () => {
  const app = setup({ accessToken: 'test-token' }, {
    ok: false, status: 429, json: async () => { throw new Error('Not JSON'); },
  });
  const result = await app.run();
  assert.equal(result.statusCode, 429);
  assert.match(JSON.parse(result.body).error, /Wait a little/);
});

const devicesResponse = {
  ok: true, status: 200,
  json: async () => ({ devices: [{ id: 'speaker', name: 'Speaker' }] }),
};
const unauthorized = {
  ok: false, status: 401,
  json: async () => ({ error: { message: 'The access token expired' } }),
};
function tokenResponse(refreshToken) {
  return {
    ok: true, status: 200,
    json: async () => ({ access_token: 'fresh-access', expires_in: 3600,
      ...(refreshToken ? { refresh_token: refreshToken } : {}) }),
  };
}
function assertTokenWrite(app, expectedRefreshToken) {
  const write = app.writes[0];
  assert.equal(write.TableName, 'users');
  assert.equal(write.Key.userid, 'test-user');
  assert.equal(write.UpdateExpression, 'SET accessToken = :at, expiresAt = :ea, refreshToken = :rt');
  assert.equal(write.ExpressionAttributeValues[':at'], 'fresh-access');
  assert.equal(write.ExpressionAttributeValues[':rt'], expectedRefreshToken);
  const remaining = write.ExpressionAttributeValues[':ea'] - Math.floor(Date.now() / 1000);
  assert.ok(remaining >= 3598 && remaining <= 3600);
}

for (const rotated of [true, false]) {
  test(`expired token refresh ${rotated ? 'persists rotated' : 'preserves original'} refresh token`, async () => {
    const app = setup({ accessToken: 'old-access', refreshToken: 'original-refresh', expiresAt: 1 },
      [tokenResponse(rotated ? 'rotated-refresh' : undefined), devicesResponse]);
    const result = await app.run();
    assert.equal(result.statusCode, 200);
    assert.equal(JSON.parse(result.body).players[0].id, 'speaker');
    assertTokenWrite(app, rotated ? 'rotated-refresh' : 'original-refresh');
    assert.equal(app.calls[0].url, 'https://accounts.spotify.com/api/token');
    assert.equal(app.calls[0].options.body.get('refresh_token'), 'original-refresh');
    assert.equal(app.calls[1].options.headers.Authorization, 'Bearer fresh-access');
    assert.equal(app.writes.length, 1);
  });
}

for (const expiresAt of [undefined, Math.floor(Date.now() / 1000) + 86400]) {
  test(`device 401 recovers with ${expiresAt ? 'stale future' : 'missing'} expiry`, async () => {
    const app = setup({ accessToken: 'old-access', refreshToken: 'original-refresh', expiresAt },
      [unauthorized, tokenResponse('rotated-refresh'), devicesResponse]);
    assert.equal((await app.run()).statusCode, 200);
    assert.equal(app.calls[0].options.headers.Authorization, 'Bearer old-access');
    assert.equal(app.calls[2].options.headers.Authorization, 'Bearer fresh-access');
    assertTokenWrite(app, 'rotated-refresh');
    assert.equal(app.requests(), 3);
  });
}

test('device recovery uses the refresh token rotated by proactive refresh', async () => {
  const app = setup({ accessToken: 'old', refreshToken: 'original', expiresAt: 1 },
    [tokenResponse('rotated'), unauthorized, tokenResponse(), devicesResponse]);
  assert.equal((await app.run()).statusCode, 200);
  assert.equal(app.calls[2].options.body.get('refresh_token'), 'rotated');
  assert.equal(app.writes[1].ExpressionAttributeValues[':rt'], 'rotated');
});

test('a second device 401 stops recovery and records reconnect guidance', async () => {
  const app = setup({ accessToken: 'old', refreshToken: 'original' },
    [unauthorized, tokenResponse(), unauthorized]);
  const result = await app.run();
  assert.equal(result.statusCode, 401);
  assert.match(JSON.parse(result.body).error, /Reconnect Spotify/);
  assert.equal(app.requests(), 3);
  assert.equal(app.writes[1].ExpressionAttributeValues[':msg'], JSON.parse(result.body).error);
});

test('failed recovery records an error without retrying device discovery', async () => {
  const app = setup({ accessToken: 'old', refreshToken: 'original' },
    [unauthorized, { ok: false, status: 400 }]);
  assert.equal((await app.run()).statusCode, 502);
  assert.equal(app.requests(), 2);
  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0].ExpressionAttributeValues[':src'], 'getPlayers');
});

test('device errors other than 401 do not trigger refresh', async () => {
  const app = setup({ accessToken: 'old', refreshToken: 'original' },
    { ok: false, status: 403, json: async () => ({}) });
  assert.equal((await app.run()).statusCode, 403);
  assert.equal(app.requests(), 1);
});
