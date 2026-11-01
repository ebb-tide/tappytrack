const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup({ user = { id: 'signed-in-user' }, response = { tracks: [] }, status = 200, failure } = {}) {
  const calls = [];
  const context = {
    exports: {}, URLSearchParams, AbortSignal,
    process: { env: { LAMBDA_URL: 'https://backend.test', LAMBDA_SECRET: 'internal-secret' } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (failure) throw failure;
      return { status, json: async () => response };
    },
    require(name) {
      if (name === 'next/server') return { NextResponse: { json: (data, options) => ({ data, ...options }) } };
      if (name === 'next-auth') return { getServerSession: async () => ({ user }) };
      if (name === '@/lib/auth') return { authOptions: {} };
      if (name === '@/lib/upstream') return { upstreamJson: res => res.json() };
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  const source = readFileSync(resolve(__dirname, '../app/api/search-tracks/route.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { calls, run: (query = 'q=song') => context.exports.GET({
    nextUrl: new URL(`https://app.test/api/search-tracks?${query}`), signal: new AbortController().signal,
  }) };
}

test('search requires a signed-in user before contacting the backend', async () => {
  const app = setup({ user: null });
  assert.equal((await app.run()).status, 401);
  assert.equal(app.calls.length, 0);
});

test('search forwards the session user, ignoring a supplied userid', async () => {
  const app = setup();
  const result = await app.run('q=Miles%20Davis&userid=someone-else');
  const url = new URL(app.calls[0].url);
  assert.equal(url.searchParams.get('userid'), 'signed-in-user');
  assert.equal(url.searchParams.get('q'), 'Miles Davis');
  assert.equal(app.calls[0].options.headers['x-internal'], 'internal-secret');
  assert.equal(app.calls[0].options.cache, 'no-store');
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.doesNotMatch(JSON.stringify(result.data), /internal-secret/);
});

test('invalid query lengths never reach the backend', async () => {
  const app = setup();
  for (const query of ['', 'q=a', `q=${'x'.repeat(121)}`]) {
    assert.equal((await app.run(query)).status, 400);
  }
  assert.equal(app.calls.length, 0);
});

test('rate-limit cooldown survives proxying', async () => {
  const app = setup({ status: 429, response: { error: 'Wait', retryAfter: 12 } });
  const result = await app.run();
  assert.equal(result.status, 429);
  assert.equal(result.data.retryAfter, 12);
});

test('network errors return a helpful message without leaking internal details', async () => {
  const result = await setup({ failure: new Error('internal-secret') }).run();
  assert.equal(result.status, 502);
  assert.match(result.data.error, /Please try again/);
  assert.doesNotMatch(result.data.error, /internal-secret/);
});
