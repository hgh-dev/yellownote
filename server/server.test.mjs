import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('API rejects unauthenticated access and only permits the app origin', async () => {
  const port = 30000 + Math.floor(Math.random() * 10000);
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: {
      ...process.env,
      PORT: String(port), GOOGLE_CLOUD_PROJECT: 'yellownote',
      GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret',
      PUBLIC_BASE_URL: `https://api.example.test`, FRONTEND_URL: 'https://hgh-dev.github.io/yellownote/',
      SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    }, stdio: 'ignore',
  });
  try {
    let response;
    for (let i = 0; i < 30; i++) {
      try { response = await fetch(`http://127.0.0.1:${port}/api/session`, { headers: { Origin: 'https://hgh-dev.github.io' } }); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(response, 'server started');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { connected: false });
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://hgh-dev.github.io');
    const denied = await fetch(`http://127.0.0.1:${port}/api/auth/exchange`, { method: 'POST', headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'x' }) });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
    const cloud = await fetch(`http://127.0.0.1:${port}/api/cloud`, { headers: { Origin: 'https://hgh-dev.github.io' } });
    assert.equal(cloud.status, 401);
  } finally {
    child.kill();
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
  }
});
