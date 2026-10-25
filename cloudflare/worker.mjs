const encoder = new TextEncoder();
const decoder = new TextDecoder();
const filename = 'yellow-note-sync.json';
const scope = 'https://www.googleapis.com/auth/drive.appdata';
const cookieFlags = 'Path=/; Secure; HttpOnly; SameSite=Lax';
let cachedKeyInput;
let cachedKeys;

function randomId() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64url(value) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function cryptoKeys(env) {
  if (cachedKeyInput === env.SESSION_ENCRYPTION_KEY && cachedKeys) return cachedKeys;
  const raw = fromBase64url(env.SESSION_ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must contain 32 bytes');
  cachedKeyInput = env.SESSION_ENCRYPTION_KEY;
  cachedKeys = {
    aes: await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']),
    hmac: await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
  };
  return cachedKeys;
}
async function seal(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const { aes } = await cryptoKeys(env);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, encoder.encode(value)));
  const result = new Uint8Array(iv.length + encrypted.length);
  result.set(iv); result.set(encrypted, iv.length);
  return base64url(result);
}
async function unseal(value, env) {
  const bytes = fromBase64url(value);
  if (bytes.length < 29) throw new Error('Invalid encrypted value');
  const { aes } = await cryptoKeys(env);
  return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, aes, bytes.slice(12)));
}
async function signedId(id, env) {
  const { hmac } = await cryptoKeys(env);
  return `${id}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC', hmac, encoder.encode(id))))}`;
}
async function verifyId(value, env) {
  const [id, signature] = (value || '').split('.');
  if (!/^[\w-]{43}$/.test(id || '') || !/^[\w-]{43}$/.test(signature || '')) return null;
  const { hmac } = await cryptoKeys(env);
  return await crypto.subtle.verify('HMAC', hmac, fromBase64url(signature), encoder.encode(id)) ? id : null;
}
function cookieValue(request, name) {
  const part = (request.headers.get('Cookie') || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}
function withCookie(response, name, value, maxAge) {
  response.headers.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; ${cookieFlags}; Max-Age=${maxAge}`);
  return response;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function redirect(location) { return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } }); }
function invalidOrigin(request, env) { return request.headers.get('Origin') !== new URL(env.FRONTEND_URL).origin; }
function cors(response, request, env) {
  const origin = request.headers.get('Origin');
  if (origin && origin === new URL(env.FRONTEND_URL).origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.headers.set('Vary', 'Origin');
  }
  return response;
}
async function session(request, env) {
  const id = await verifyId(request.headers.get('Authorization')?.replace(/^Bearer /, ''), env);
  if (!id) return null;
  const row = await env.DB.prepare('SELECT refresh_token FROM sessions WHERE id = ?').bind(id).first();
  return row ? { id, refreshToken: await unseal(row.refresh_token, env) } : null;
}
async function drive(s, url, options, env) {
  if (!s.accessToken) {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: s.refreshToken, grant_type: 'refresh_token' }),
    });
    if (!tokenResponse.ok) {
      if (tokenResponse.status === 400) {
        await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(s.id).run();
        throw Object.assign(new Error('Google connection expired'), { status: 401 });
      }
      throw Object.assign(new Error('Google token refresh failed'), { status: 502 });
    }
    s.accessToken = (await tokenResponse.json()).access_token;
  }
  const response = await fetch(url, { ...options, headers: { ...options?.headers, Authorization: `Bearer ${s.accessToken}` } });
  if (!response.ok) throw Object.assign(new Error(`Google Drive error ${response.status}`), { status: response.status === 401 ? 401 : 502 });
  return response;
}
async function findDriveFile(s, env) {
  const query = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name)', q: `name = '${filename}' and trashed = false`, pageSize: '100' });
  const data = await (await drive(s, `https://www.googleapis.com/drive/v3/files?${query}`, {}, env)).json();
  return data.files?.find(file => file.name === filename)?.id || null;
}

async function handle(request, env) {
  if (!env.DB || !env.FRONTEND_URL || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.SESSION_ENCRYPTION_KEY) throw new Error('Worker configuration is incomplete');
  const url = new URL(request.url);
  const { pathname } = url;
  if (request.method === 'OPTIONS') return new Response(null, { status: invalidOrigin(request, env) ? 403 : 204 });
  if (request.method === 'GET' && pathname === '/api/auth/start') {
    const state = randomId();
    const verifier = randomId();
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
    const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${url.origin}/api/auth/callback`, response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' });
    return withCookie(redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`), 'yn_oauth', await seal(JSON.stringify({ state, verifier, time: Date.now() }), env), 600);
  }
  if (request.method === 'GET' && pathname === '/api/auth/callback') {
    let saved;
    try { saved = JSON.parse(await unseal(cookieValue(request, 'yn_oauth') || '', env)); }
    catch { return json({ error: 'Invalid OAuth state' }, 400); }
    if (!url.searchParams.get('code') || url.searchParams.get('state') !== saved.state || Date.now() - saved.time > 600_000) return json({ error: 'Invalid OAuth callback' }, 400);
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, code: url.searchParams.get('code'), code_verifier: saved.verifier, redirect_uri: `${url.origin}/api/auth/callback`, grant_type: 'authorization_code' }),
    });
    const data = await response.json();
    if (!response.ok || !data.refresh_token) return json({ error: 'Google did not provide an offline token. Try login again.' }, 502);
    const id = randomId();
    const code = randomId();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO sessions (id, refresh_token, created_at) VALUES (?, ?, ?)').bind(id, await seal(data.refresh_token, env), Date.now()),
      env.DB.prepare('INSERT INTO exchanges (code, session_id, expires_at) VALUES (?, ?, ?)').bind(code, id, Date.now() + 300_000),
    ]);
    return withCookie(redirect(`${env.FRONTEND_URL}#login=${code}`), 'yn_oauth', '', 0);
  }
  if (request.method === 'POST' && pathname === '/api/auth/exchange') {
    if (invalidOrigin(request, env)) return json({ error: 'Invalid origin' }, 403);
    const body = await request.json().catch(() => null);
    if (typeof body?.code !== 'string' || !/^[\w-]{43}$/.test(body.code)) return json({ error: 'Invalid code' }, 400);
    const row = await env.DB.prepare('DELETE FROM exchanges WHERE code = ? RETURNING session_id, expires_at').bind(body.code).first();
    if (!row || row.expires_at < Date.now()) return json({ error: 'Code expired' }, 400);
    return json({ session: await signedId(row.session_id, env) });
  }
  if (request.method === 'GET' && pathname === '/api/session') return json({ connected: !!(await session(request, env)) });
  if (request.method === 'POST' && pathname === '/api/logout') {
    if (invalidOrigin(request, env)) return json({ error: 'Invalid origin' }, 403);
    const s = await session(request, env);
    if (s) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(s.id).run();
    return json({ connected: false });
  }
  if (pathname === '/api/cloud' && ['GET', 'PUT'].includes(request.method)) {
    if (request.method === 'PUT' && invalidOrigin(request, env)) return json({ error: 'Invalid origin' }, 403);
    const s = await session(request, env);
    if (!s) return json({ error: 'Sign in required' }, 401);
    const id = await findDriveFile(s, env);
    if (request.method === 'GET') return json(id ? await (await drive(s, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, {}, env)).json() : null);
    const body = await request.text();
    if (body.length > 10_000_000) return json({ error: 'Request too large' }, 413);
    const parsed = JSON.parse(body);
    if (parsed?.app !== 'yellow-note-sync' || parsed?.version !== 2 || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.pages) || !Array.isArray(parsed.deleted) || !parsed.settings) return json({ error: 'Invalid sync data' }, 400);
    const boundary = `yellow_note_${randomId()}`;
    const metadata = id ? { name: filename } : { name: filename, mimeType: 'application/json', parents: ['appDataFolder'] };
    const uploadBody = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}\r\n--${boundary}--`;
    await drive(s, id ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=multipart` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: uploadBody }, env);
    return json({ ok: true });
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    try { return cors(await handle(request, env), request, env); }
    catch (error) { console.error(error); return cors(json({ error: 'Request failed' }, error.status || 500), request, env); }
  },
};
