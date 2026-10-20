const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

const root = resolve(__dirname, '..');

function clientSetup({ enabled = true, send = async () => ({ StatusCode: 202 }) } = {}) {
  const calls = [];
  const logs = [];
  const deadlines = [];
  const controller = new AbortController();
  const context = {
    module: { exports: {} }, Buffer,
    process: { env: enabled ? { NOTIFICATION_FUNCTION: 'telegram-worker' } : {} },
    console: { error: (...args) => logs.push(args) },
    AbortSignal: { timeout: ms => { deadlines.push(ms); return controller.signal; } },
    require(name) {
      assert.equal(name, '@aws-sdk/client-lambda');
      return {
        LambdaClient: class {
          constructor(options) { assert.equal(options.maxAttempts, 1); }
          async send(command, options) {
            calls.push({ input: command.input, options });
            return send(command, options);
          }
        },
        InvokeCommand: class { constructor(input) { this.input = input; } },
      };
    },
  };
  vm.runInNewContext(readFileSync(resolve(root, 'layers/notifications/notify.js'), 'utf8'), context);
  return { notify: context.module.exports.notify, calls, logs, deadlines, controller };
}

function workerSetup(fetch, env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: 'test-chat' }) {
  const context = { exports: {}, process: { env }, fetch, AbortSignal };
  vm.runInNewContext(readFileSync(resolve(root, 'lambdas/telegramNotify/index.js'), 'utf8'), context);
  return context.exports.handler;
}

test('notification handoff uses Event invocation and sends only message text', async () => {
  const app = clientSetup();
  await app.notify('Card tapped');
  assert.equal(app.calls[0].input.InvocationType, 'Event');
  assert.equal(app.calls[0].input.FunctionName, 'telegram-worker');
  assert.deepEqual(JSON.parse(app.calls[0].input.Payload.toString()), { text: 'Card tapped' });
  assert.deepEqual(app.deadlines, [500]);
});

test('disabled notifications make no AWS request', async () => {
  const app = clientSetup({ enabled: false });
  await app.notify('ignored');
  assert.equal(app.calls.length, 0);
});

test('failed or unaccepted submission does not fail the originating action', async () => {
  for (const send of [async () => { throw new Error('private payload'); }, async () => ({ StatusCode: 500 })]) {
    const app = clientSetup({ send });
    await app.notify('private message');
    assert.equal(app.logs.length, 1);
    assert.doesNotMatch(JSON.stringify(app.logs), /private/);
  }
});

test('a stalled submission is cancellable by the handoff deadline', async () => {
  const app = clientSetup({ send: (_, { abortSignal }) => new Promise((resolve, reject) => {
    abortSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  const pending = app.notify('Card tapped');
  app.controller.abort();
  await pending;
  assert.equal(app.logs.length, 1);
  assert.deepEqual(app.deadlines, [500]);
});

test('worker sends Telegram request separately from submission', async () => {
  let calls = 0;
  const worker = workerSetup(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.telegram.org/bottest-token/sendMessage');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { chat_id: 'test-chat', text: 'Card tapped' });
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ ok: true }) };
  });
  await worker({ text: 'Card tapped' });
  assert.equal(calls, 1);
});

test('worker skips delivery when Telegram is not configured', async () => {
  await workerSetup(() => assert.fail('unexpected network request'), {})({ text: 'ignored' });
});

test('worker rejects invalid messages before sending', async () => {
  const worker = workerSetup(() => assert.fail('unexpected network request'));
  for (const event of [null, {}, { text: '' }, { text: ' ' }, { text: 12 }]) {
    await assert.rejects(worker(event), /Notification text is required/);
  }
});

test('worker throws on HTTP and Telegram API failures so AWS retries delivery', async () => {
  await assert.rejects(workerSetup(async () => ({ ok: false, status: 429 }))({ text: 'message' }), /HTTP 429/);
  await assert.rejects(workerSetup(async () => ({ ok: true, json: async () => ({ ok: false }) }))({ text: 'message' }), /rejected/);
});

test('network errors do not expose the token-bearing URL', async () => {
  const worker = workerSetup(async () => { throw new Error('https://api.telegram.org/bottest-token/sendMessage'); });
  await assert.rejects(worker({ text: 'message' }), err => {
    assert.match(err.message, /failed or timed out/);
    assert.doesNotMatch(err.stack, /test-token/);
    return true;
  });
});

for (const [name, body, status, expectedText, existingUser] of [
  ['registerUser', { userid: 'u', name: 'User', email: 'u@example.test', image: '', accessToken: 'token', refreshToken: 'refresh', expiresAt: 1 }, 201, /New user/, false],
  ['registerUser', { userid: 'u', name: 'User', accessToken: 'token' }, 200, /signed in/, true],
  ['addDevice', { userid: 'u', deviceid: 'd' }, 200, /claimed/, true],
  ['addCard', { userid: 'u', cardID: 'AABB', spotifyURL: 'https://open.spotify.com/track/abc' }, 201, /added a card/, true],
  ['tapCard', { deviceid: 'd', cardID: 'AABB' }, 200, /assign it/, true],
]) {
  test(`${name} hands off its notification without making a Telegram request (${status})`, async () => {
    const messages = [];
    const context = {
      exports: {}, Buffer, URLSearchParams,
      process: { env: { INTERNAL_SECRET: 'secret', USERS_TABLE: 'users', DEVICES_TABLE: 'devices', CARDS_TABLE: 'cards' } },
      console: { log() {}, error() {} },
      async fetch(url) {
        assert.ok(url.startsWith('https://accounts.spotify.com/') || url.startsWith('https://api.spotify.com/'));
        return { ok: true, json: async () => url.includes('/token') ? { access_token: 'app-token' } : { name: 'Track', artists: [] } };
      },
      require(module) {
        if (module === '/opt/spotify-token') {
          const nested = { ...context, module: { exports: {} } };
          vm.runInNewContext(readFileSync(resolve(root, 'layers/spotify/spotify-token.js'), 'utf8'), nested);
          return nested.module.exports;
        }
        if (module === '/opt/notify') return { notify: async text => messages.push(text) };
        if (module === './deadline') return {
          createDeadline: () => ({ fetch: context.fetch, send: (client, command) => client.send(command) }),
          isTimeout: () => false,
        };
        if (module === '@aws-sdk/client-dynamodb') return { DynamoDBClient: class {} };
        if (module === '@aws-sdk/lib-dynamodb') return {
          GetCommand: class { constructor(input) { this.input = input; } },
          PutCommand: class {}, UpdateCommand: class {},
          DynamoDBDocumentClient: { from: () => ({ send: async command => {
            if (command.input?.TableName === 'devices') return { Item: { userid: 'u' } };
            if (command.input?.TableName === 'users') return { Item: existingUser ? { userid: 'u' } : undefined };
            return {};
          } }) },
        };
        throw new Error(`Unexpected module: ${module}`);
      },
    };
    vm.runInNewContext(readFileSync(resolve(root, `lambdas/${name}/index.js`), 'utf8'), context);
    const result = await context.exports.handler({ headers: { 'x-internal': 'secret' }, body: JSON.stringify(body) });
    assert.equal(result.statusCode, status);
    assert.equal(messages.length, 1);
    assert.match(messages[0], expectedText);
  });
}
