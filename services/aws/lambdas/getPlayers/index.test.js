const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

function setup(user, response) {
  const writes = [];
  let requests = 0;
  class GetCommand { constructor(input) { this.input = input; } }
  class UpdateCommand { constructor(input) { this.input = input; } }
  const context = {
    exports: {},
    process: { env: { USERS_TABLE: 'users', INTERNAL_SECRET: 'test-secret' } },
    console,
    URLSearchParams,
    require(name) {
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
    async fetch() { requests++; return response; },
  };
  vm.runInNewContext(readFileSync(`${__dirname}/index.js`, 'utf8'), context);
  return {
    writes,
    requests: () => requests,
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
