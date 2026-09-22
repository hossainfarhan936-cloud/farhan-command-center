/* Command Center API — Cloudflare Pages Function (same origin as the app).
   Routes:
     GET  /api/health            → liveness
     GET  /api/session           → { authenticated, needsSetup }
     POST /api/login             → { passcode } → sets signed session cookie
     POST /api/logout            → clears cookie
     GET  /api/state             → { state, updatedAt }
     PUT  /api/state             → { state } → saves (single-user document)
     POST /api/passcode          → { current, next } → rotate passcode
   Auth: PBKDF2-SHA256 passcode hash in D1 + HMAC-signed session cookie. */

const COOKIE = 'cc_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PBKDF2_ITER = 100000;

const enc = new TextEncoder();

/* ---------- helpers ---------- */
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array((hex.match(/.{2}/g) || []).map((b) => parseInt(b, 16)));

async function sha256hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

async function pbkdf2Hex(passcode, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations: PBKDF2_ITER, hash: 'SHA-256' },
    key, 256);
  return toHex(bits);
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}
async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value).run();
}

async function sessionSecret(env) {
  let secret = await getSetting(env, 'session_secret');
  if (!secret) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    secret = toHex(bytes);
    await setSetting(env, 'session_secret', secret);
  }
  return secret;
}

function readCookie(request, name) {
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

async function isAuthed(request, env) {
  const token = readCookie(request, COOKIE);
  if (!token) return false;
  const [expiry, sig] = token.split('.');
  if (!expiry || !sig) return false;
  if (Number(expiry) < Date.now()) return false;
  const secret = await sessionSecret(env);
  const expected = await hmacHex(secret, expiry);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

function sessionCookie(value, maxAge) {
  const parts = [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  parts.push(maxAge === 0 ? 'Max-Age=0' : `Max-Age=${maxAge}`);
  return parts.join('; ');
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

/* ---------- routes ---------- */
export async function onRequest(context) {
  const { request, env, params } = context;
  const segs = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const route = segs.join('/');
  const method = request.method.toUpperCase();

  if (!env.DB) return json({ error: 'Database binding missing (env.DB).' }, 500);

  try {
    if (route === 'health') return json({ ok: true, time: new Date().toISOString() });

    if (route === 'session' && method === 'GET') {
      const hash = await getSetting(env, 'passcode_hash');
      const authed = await isAuthed(request, env);
      const out = { authenticated: authed, needsSetup: !hash };
      if (authed) out.email = await getSetting(env, 'login_email');
      return json(out);
    }

    if (route === 'login' && method === 'POST') {
      const { email, passcode } = await body(request);
      if (!passcode || typeof passcode !== 'string') return json({ error: 'Passcode required.' }, 400);
      const salt = await getSetting(env, 'passcode_salt');
      const hash = await getSetting(env, 'passcode_hash');
      if (!salt || !hash) return json({ error: 'No passcode is set on this dashboard.', needsSetup: true }, 409);
      const expectedEmail = await getSetting(env, 'login_email');
      const givenPass = String(passcode).trim();
      if (expectedEmail) {
        const given = String(email || '').trim().toLowerCase();
        if (given !== expectedEmail.trim().toLowerCase()) {
          console.log('login-fail reason=email');
          await new Promise((r) => setTimeout(r, 600));
          return json({ error: 'That email does not match this dashboard.' }, 401);
        }
      }
      const attempt = await pbkdf2Hex(givenPass, salt);
      if (attempt !== hash) {
        console.log('login-fail reason=passcode len=' + givenPass.length);
        await new Promise((r) => setTimeout(r, 600)); // slow down guessing
        return json({ error: 'Wrong passcode (email was accepted).' }, 401);
      }
      console.log('login-ok');
      const expiry = String(Date.now() + SESSION_MS);
      const token = `${expiry}.${await hmacHex(await sessionSecret(env), expiry)}`;
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, Math.floor(SESSION_MS / 1000)) });
    }

    if (route === 'logout' && method === 'POST') {
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
    }

    if (route === 'state') {
      if (!(await isAuthed(request, env))) return json({ error: 'Not authenticated.' }, 401);
      if (method === 'GET') {
        const row = await env.DB.prepare('SELECT data, updated_at FROM app_state WHERE id = 1').first();
        if (!row) return json({ state: null, updatedAt: null });
        let parsed = null;
        try { parsed = JSON.parse(row.data); } catch { parsed = null; }
        return json({ state: parsed, updatedAt: row.updated_at });
      }
      if (method === 'PUT' || method === 'POST') {
        const { state } = await body(request);
        if (!state || typeof state !== 'object') return json({ error: 'state object required.' }, 400);
        const data = JSON.stringify(state);
        if (data.length > 2_000_000) return json({ error: 'State too large (2 MB limit).' }, 413);
        const nowIso = new Date().toISOString();
        await env.DB.prepare(
          'INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
        ).bind(data, nowIso).run();
        return json({ ok: true, updatedAt: nowIso, bytes: data.length });
      }
      return json({ error: 'Method not allowed.' }, 405);
    }

    if (route === 'daily') {
      if (!(await isAuthed(request, env))) return json({ error: 'Not authenticated.' }, 401);
      if (method === 'GET') {
        // the daily job writes on Asia/Dhaka dates (UTC+6)
        const dhakaDay = new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);
        const row = await env.DB.prepare('SELECT * FROM daily WHERE day = ?').bind(dhakaDay).first();
        if (row) return json({ today: row, requestedDay: dhakaDay });
        const latest = await env.DB.prepare('SELECT * FROM daily ORDER BY day DESC LIMIT 1').first();
        return json({ today: null, latest: latest || null, requestedDay: dhakaDay });
      }
      return json({ error: 'Method not allowed.' }, 405);
    }

    if (route === 'passcode' && method === 'POST') {
      if (!(await isAuthed(request, env))) return json({ error: 'Not authenticated.' }, 401);
      const { next, email } = await body(request);
      if (email !== undefined) {
        const trimmed = String(email).trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return json({ error: 'Enter a valid email address.' }, 400);
        await setSetting(env, 'login_email', trimmed);
      }
      if (next === undefined || next === null || next === '') {
        return json({ ok: true, email: await getSetting(env, 'login_email') });
      }
      if (String(next).length < 8) return json({ error: 'New passcode must be at least 8 characters.' }, 400);
      const saltBytes = crypto.getRandomValues(new Uint8Array(16));
      const salt = toHex(saltBytes);
      await setSetting(env, 'passcode_salt', salt);
      await setSetting(env, 'passcode_hash', await pbkdf2Hex(String(next), salt));
      return json({ ok: true, email: await getSetting(env, 'login_email') });
    }

    return json({ error: 'Unknown route: /api/' + route }, 404);
  } catch (err) {
    return json({ error: 'Server error: ' + (err && err.message ? err.message : String(err)) }, 500);
  }
}