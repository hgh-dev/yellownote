import http from 'node:http';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const project = process.env.GOOGLE_CLOUD_PROJECT;
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
const frontendUrl = process.env.FRONTEND_URL;
const key = process.env.SESSION_ENCRYPTION_KEY ? Buffer.from(process.env.SESSION_ENCRYPTION_KEY, 'base64') : null;
if (!project || !clientId || !clientSecret || !baseUrl || !frontendUrl || key?.length !== 32 || !baseUrl.startsWith('https://') || !frontendUrl.startsWith('https://')) {
  throw new Error('Set GOOGLE_CLOUD_PROJECT, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, HTTPS PUBLIC_BASE_URL, FRONTEND_URL and a 32-byte base64 SESSION_ENCRYPTION_KEY.');
}
const origin = new URL(frontendUrl).origin;
const callbackUrl = `${baseUrl}/api/auth/callback`;
const collection = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/sessions`;
const exchanges = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/exchanges`;
const scope = 'https://www.googleapis.com/auth/drive.appdata';
const cookieOptions = 'Path=/; Secure; HttpOnly; SameSite=Lax';
const filename = 'yellow-note-sync.json';

function seal(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}
function unseal(encoded) {
  const raw = Buffer.from(encoded, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return decipher.update(raw.subarray(12, -16), undefined, 'utf8') + decipher.final('utf8');
}
function signedId(id) { return `${id}.${createHmac('sha256', key).update(id).digest('base64url')}`; }
function verifyId(value) {
  const [id, mac] = (value || '').split('.');
  if (!id || !mac || !/^[\w-]{43}$/.test(id)) return null;
  const expected = Buffer.from(signedId(id).split('.')[1]);
  const actual = Buffer.from(mac);
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? id : null;
}
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(c => c.length === 2)); }
function cookie(res, name, value, maxAge) { res.setHeader('Set-Cookie', [...(res.getHeader('Set-Cookie') || []), `${name}=${encodeURIComponent(value)}; ${cookieOptions}; Max-Age=${maxAge}`]); }
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
function redirect(res, location) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }
async function googleAccessToken() {
  const response = await fetch('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', { headers: { 'Metadata-Flavor': 'Google' } });
  if (!response.ok) throw new Error('Cloud Run identity is unavailable');
  return (await response.json()).access_token;
}
async function firestore(method, id, body, endpoint = collection) {
  const response = await fetch(`${endpoint}/${encodeURIComponent(id)}`, {
    method, headers: { Authorization: `Bearer ${await googleAccessToken()}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  if (response.status === 404 && method === 'GET') return null;
  if (!response.ok) throw new Error(`Firestore error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.status === 204 ? null : response.json();
}
async function session(req) {
  const id = verifyId(req.headers.authorization?.replace(/^Bearer /, ''));
  if (!id) return null;
  const doc = await firestore('GET', id);
  return doc ? { id, refreshToken: unseal(doc.fields.refreshToken.stringValue) } : null;
}
async function drive(session, url, options = {}) {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: session.refreshToken, grant_type: 'refresh_token' }),
  });
  if (!tokenResponse.ok) {
    if (tokenResponse.status === 400) { await firestore('DELETE', session.id).catch(() => {}); throw Object.assign(new Error('Google connection expired'), { status: 401 }); }
    throw new Error(`Google token refresh failed (${tokenResponse.status})`);
  }
  const accessToken = (await tokenResponse.json()).access_token;
  const response = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw Object.assign(new Error(`Google Drive error ${response.status}`), { status: response.status === 401 ? 401 : 502 });
  return response;
}
async function findDriveFile(s) {
  const query = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name)', q: `name = '${filename}' and trashed = false`, pageSize: '100' });
  const data = await (await drive(s, `https://www.googleapis.com/drive/v3/files?${query}`)).json();
  return data.files?.find(file => file.name === filename)?.id || null;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 10_000_000) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } });
    req.on('end', () => resolve(body)); req.on('error', reject);
  });
}
function sameOrigin(req) { return req.headers.origin === origin; }
function cors(req, res) {
  if (req.headers.origin === origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
}
async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return json(res, 400, { error: 'Invalid path' }); }
  if (decoded.includes('\\') || decoded.split('/').includes('..')) return json(res, 400, { error: 'Invalid path' });
  let file = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!file.startsWith(`${root}${path.sep}`)) return json(res, 403, { error: 'Forbidden' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
  } catch {
    if (path.extname(decoded)) return json(res, 404, { error: 'Not found' });
    file = path.resolve(root, 'index.html');
  }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=3600' });
  if (req.method === 'HEAD') return res.end();
  res.end(await readFile(file));
}
async function handle(req, res) {
  const url = new URL(req.url, baseUrl);
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(req.headers.origin === origin ? 204 : 403); return res.end(); }
  if (req.method === 'GET' && pathname === '/api/auth/start') {
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    cookie(res, 'yn_oauth', seal(JSON.stringify({ state, verifier, time: Date.now() })), 600);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: callbackUrl, response_type: 'code', scope, access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' });
    return redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }
  if (req.method === 'GET' && pathname === '/api/auth/callback') {
    let saved;
    try { saved = JSON.parse(unseal(cookies(req).yn_oauth || '')); } catch { return json(res, 400, { error: 'Invalid OAuth state' }); }
    cookie(res, 'yn_oauth', '', 0);
    if (!url.searchParams.get('code') || url.searchParams.get('state') !== saved.state || Date.now() - saved.time > 600_000) return json(res, 400, { error: 'Invalid OAuth callback' });
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code: url.searchParams.get('code'), code_verifier: saved.verifier, redirect_uri: callbackUrl, grant_type: 'authorization_code' }) });
    const data = await response.json();
    if (!response.ok || !data.refresh_token) return json(res, 502, { error: 'Google did not provide an offline token. Try login again.' });
    const id = randomBytes(32).toString('base64url');
    await firestore('PATCH', id, { fields: { refreshToken: { stringValue: seal(data.refresh_token) }, createdAt: { timestampValue: new Date().toISOString() } } });
    const code = randomBytes(32).toString('base64url');
    await firestore('PATCH', code, { fields: { sessionId: { stringValue: id }, expiresAt: { timestampValue: new Date(Date.now() + 5 * 60_000).toISOString() } } }, exchanges);
    return redirect(res, `${frontendUrl}#login=${code}`);
  }
  if (req.method === 'POST' && pathname === '/api/auth/exchange') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Invalid origin' });
    const code = JSON.parse(await readBody(req)).code;
    if (typeof code !== 'string' || !/^[\w-]{43}$/.test(code)) return json(res, 400, { error: 'Invalid code' });
    const doc = await firestore('GET', code, null, exchanges);
    if (!doc) return json(res, 400, { error: 'Code expired' });
    await firestore('DELETE', code, null, exchanges);
    if (Date.now() > Date.parse(doc.fields.expiresAt.timestampValue)) return json(res, 400, { error: 'Code expired' });
    return json(res, 200, { session: signedId(doc.fields.sessionId.stringValue) });
  }
  if (req.method === 'GET' && pathname === '/api/session') return json(res, 200, { connected: !!(await session(req)) });
  if (req.method === 'POST' && pathname === '/api/logout') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Invalid origin' });
    const s = await session(req);
    if (s) await firestore('DELETE', s.id);
    return json(res, 200, { connected: false });
  }
  if (pathname === '/api/cloud' && ['GET', 'PUT'].includes(req.method)) {
    if (req.method === 'PUT' && !sameOrigin(req)) return json(res, 403, { error: 'Invalid origin' });
    const s = await session(req);
    if (!s) return json(res, 401, { error: 'Sign in required' });
    const id = await findDriveFile(s);
    if (req.method === 'GET') return json(res, 200, id ? await (await drive(s, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`)).json() : null);
    const body = await readBody(req);
    const parsed = JSON.parse(body);
    if (parsed?.app !== 'yellow-note-sync' || parsed?.version !== 2 || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.pages) || !Array.isArray(parsed.deleted) || !parsed.settings) return json(res, 400, { error: 'Invalid sync data' });
    const boundary = `yellow_note_${randomBytes(12).toString('hex')}`;
    const metadata = id ? { name: filename } : { name: filename, mimeType: 'application/json', parents: ['appDataFolder'] };
    const uploadBody = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${body}\r\n--${boundary}--`;
    await drive(s, id ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=multipart` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: uploadBody });
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Not found' });
}
http.createServer((req, res) => { Promise.resolve(handle(req, res)).catch(error => { console.error(error); if (!res.headersSent) json(res, error.status || 500, { error: 'Request failed' }); else res.end(); }); }).listen(process.env.PORT || 8080);
