import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

const api = 'https://yellownote-sync.example.workers.dev';
const origin = 'https://hgh-dev.github.io';
const env = {
  DB: { prepare() { throw new Error('Unauthenticated requests must not use the database'); } },
  GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
  FRONTEND_URL: `${origin}/yellownote/`,
  SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

test('Worker limits browser access to the app origin and requires a session', async () => {
  const preflight = await worker.fetch(new Request(`${api}/api/cloud`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT' } }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  const denied = await worker.fetch(new Request(`${api}/api/auth/exchange`, { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: '{}' }), env);
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const cloud = await worker.fetch(new Request(`${api}/api/cloud`, { headers: { Origin: origin } }), env);
  assert.equal(cloud.status, 401);
});

test('OAuth start uses offline access, PKCE, and a short-lived state cookie', async () => {
  const response = await worker.fetch(new Request(`${api}/api/auth/start`), env);
  assert.equal(response.status, 302);
  const url = new URL(response.headers.get('location'));
  assert.equal(url.searchParams.get('redirect_uri'), `${api}/api/auth/callback`);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('state'));
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=600/);
});

test('one login survives a new request and logout revokes that session', async () => {
  const sessions = new Map();
  const exchanges = new Map();
  const database = {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (sql.startsWith('SELECT refresh_token')) return sessions.has(values[0]) ? { refresh_token: sessions.get(values[0]) } : null;
              if (sql.startsWith('DELETE FROM exchanges')) {
                const row = exchanges.get(values[0]) || null;
                exchanges.delete(values[0]);
                return row;
              }
              throw new Error(`Unexpected query: ${sql}`);
            },
            async run() {
              if (sql.startsWith('DELETE FROM sessions')) { sessions.delete(values[0]); return; }
              if (sql.startsWith('INSERT INTO sessions')) { sessions.set(values[0], values[1]); return; }
              if (sql.startsWith('INSERT INTO exchanges')) { exchanges.set(values[0], { session_id: values[1], expires_at: values[2] }); return; }
              throw new Error(`Unexpected query: ${sql}`);
            },
          };
        },
      };
    },
    async batch(statements) { for (const statement of statements) await statement.run(); },
  };
  const configured = { ...env, DB: database };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ refresh_token: 'test-refresh-token', access_token: 'test-access-token' }), { headers: { 'Content-Type': 'application/json' } });
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const start = await worker.fetch(new Request(`${api}/api/auth/start`), configured);
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const cookie = start.headers.get('set-cookie').split(';')[0];
    const callback = await worker.fetch(new Request(`${api}/api/auth/callback?state=${state}&code=google-code`, { headers: { Cookie: cookie } }), configured);
    assert.equal(callback.status, 302);
    assert.equal(sessions.size, 1);
    assert.doesNotMatch([...sessions.values()][0], /test-refresh-token/);
    const code = new URL(callback.headers.get('location')).hash.slice('#login='.length);
    const exchange = await worker.fetch(new Request(`${api}/api/auth/exchange`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }), configured);
    assert.equal(exchange.status, 200);
    const bearer = (await exchange.json()).session;
    const connected = await worker.fetch(new Request(`${api}/api/session`, { headers: { Origin: origin, Authorization: `Bearer ${bearer}` } }), configured);
    assert.deepEqual(await connected.json(), { connected: true });
    const replay = await worker.fetch(new Request(`${api}/api/auth/exchange`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }), configured);
    assert.equal(replay.status, 400);
    const logout = await worker.fetch(new Request(`${api}/api/logout`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${bearer}` } }), configured);
    assert.equal(logout.status, 200);
    const disconnected = await worker.fetch(new Request(`${api}/api/session`, { headers: { Origin: origin, Authorization: `Bearer ${bearer}` } }), configured);
    assert.deepEqual(await disconnected.json(), { connected: false });
  } finally { globalThis.fetch = originalFetch; }
});
