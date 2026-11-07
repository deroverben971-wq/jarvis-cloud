const APP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const APP_SESSION_DAYS = 30;
const APP_CODE_MINUTES = 10;
const MAX_PAIR_ATTEMPTS = 5;

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function allowedOrigins(env) {
  return String(env.JARVIS_APP_ORIGIN || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function isAllowedAppOrigin(request, env) {
  const origin = String(request.headers.get("Origin") || "").replace(/\/$/, "");
  return Boolean(origin && allowedOrigins(env).includes(origin));
}

function corsHeaders(request, env) {
  const origin = String(request.headers.get("Origin") || "").replace(/\/$/, "");
  const headers = new Headers({
    "Vary": "Origin",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600"
  });
  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function apiResponse(request, env, body, status = 200) {
  const headers = corsHeaders(request, env);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

export async function createAppPairingCode(env) {
  if (!env.DB) throw new Error("JARVIS app database is unavailable.");
  const random = new Uint8Array(12);
  crypto.getRandomValues(random);
  let code = "";
  for (const byte of random) code += APP_CODE_ALPHABET[byte % APP_CODE_ALPHABET.length];
  const now = new Date();
  const expires = new Date(now.getTime() + APP_CODE_MINUTES * 60_000);
  const codeHash = await sha256(code);
  await env.DB.prepare(
    "INSERT INTO app_pairing_codes (id, code_hash, created_at, expires_at, used_at, failed_attempts) " +
    "VALUES (1, ?, ?, ?, NULL, 0) ON CONFLICT(id) DO UPDATE SET " +
    "code_hash = excluded.code_hash, created_at = excluded.created_at, " +
    "expires_at = excluded.expires_at, used_at = NULL, failed_attempts = 0"
  ).bind(codeHash, now.toISOString(), expires.toISOString()).run();
  return { code, expiresAt: expires.toISOString() };
}

async function getSessionFromToken(env, token, touch = false) {
  if (!token || typeof token !== "string" || token.length < 30 || token.length > 200) return null;
  const tokenHash = await sha256(token);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    "SELECT token_hash, expires_at FROM app_sessions " +
    "WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?"
  ).bind(tokenHash, now).first();
  if (!row) return null;
  if (touch) {
    await env.DB.prepare("UPDATE app_sessions SET last_seen_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(now, tokenHash).run();
  }
  return { tokenHash, expiresAt: row.expires_at };
}

export async function authenticateAppRequest(request, env, allowQuery = false) {
  const authorization = request.headers.get("Authorization") || "";
  let token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1] || "";
  if (!token && allowQuery) {
    token = new URL(request.url).searchParams.get("token") || "";
  }
  return getSessionFromToken(env, token, true);
}

export async function handleAppApiRequest(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (!isAllowedAppOrigin(request, env)) {
    return apiResponse(request, env, { ok: false, error: "This app origin is not authorized." }, 403);
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  if (url.pathname === "/app/api/pair" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch {
      return apiResponse(request, env, { ok: false, error: "Invalid request." }, 400);
    }
    const code = String(body?.code || "").trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{12}$/.test(code)) {
      return apiResponse(request, env, { ok: false, error: "The pairing code is invalid or expired." }, 400);
    }
    const now = new Date().toISOString();
    const codeHash = await sha256(code);
    const pairing = await env.DB.prepare(
      "SELECT code_hash, expires_at, used_at, failed_attempts FROM app_pairing_codes WHERE id = 1"
    ).first();
    if (!pairing || pairing.used_at || pairing.expires_at <= now ||
        Number(pairing.failed_attempts || 0) >= MAX_PAIR_ATTEMPTS || pairing.code_hash !== codeHash) {
      if (pairing && !pairing.used_at && pairing.expires_at > now &&
          Number(pairing.failed_attempts || 0) < MAX_PAIR_ATTEMPTS) {
        await env.DB.prepare(
          "UPDATE app_pairing_codes SET failed_attempts = failed_attempts + 1 WHERE id = 1 AND used_at IS NULL"
        ).run();
      }
      return apiResponse(request, env, { ok: false, error: "The pairing code is invalid or expired. Request a new one in Telegram." }, 401);
    }
    const consumed = await env.DB.prepare(
      "UPDATE app_pairing_codes SET used_at = ? WHERE id = 1 AND code_hash = ? AND used_at IS NULL AND expires_at > ? AND failed_attempts < ?"
    ).bind(now, codeHash, now, MAX_PAIR_ATTEMPTS).run();
    if (Number(consumed.meta?.changes || 0) !== 1) {
      return apiResponse(request, env, { ok: false, error: "That pairing code has already been used. Request a new one." }, 409);
    }

    const randomToken = new Uint8Array(32);
    crypto.getRandomValues(randomToken);
    const token = toBase64Url(randomToken);
    const tokenHash = await sha256(token);
    const expires = new Date(Date.now() + APP_SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      "INSERT INTO app_sessions (token_hash, created_at, expires_at, last_seen_at, revoked_at) VALUES (?, ?, ?, ?, NULL)"
    ).bind(tokenHash, now, expires, now).run();
    return apiResponse(request, env, { ok: true, token, expiresAt: expires });
  }

  if (url.pathname === "/app/api/session" && request.method === "GET") {
    const session = await authenticateAppRequest(request, env);
    if (!session) return apiResponse(request, env, { ok: false, error: "Your app session has expired." }, 401);
    return apiResponse(request, env, { ok: true, expiresAt: session.expiresAt });
  }

  if (url.pathname === "/app/api/session" && request.method === "DELETE") {
    const session = await authenticateAppRequest(request, env);
    if (!session) return apiResponse(request, env, { ok: false, error: "Session not found." }, 401);
    await env.DB.prepare("UPDATE app_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .bind(new Date().toISOString(), session.tokenHash).run();
    return apiResponse(request, env, { ok: true });
  }

  return apiResponse(request, env, { ok: false, error: "Not found." }, 404);
}
