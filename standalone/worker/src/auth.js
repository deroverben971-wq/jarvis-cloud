const PASSWORD_ITERATIONS = 310000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

async function derivePasswordHash(password, saltHex) {
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" }, key, 256
  );
  return toHex(new Uint8Array(bits));
}

async function constantTimeEqual(left, right) {
  const [a, b] = await Promise.all([sha256(String(left)), sha256(String(right))]);
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.display_name || "", createdAt: user.created_at };
}

async function issueSession(db, user) {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256(token);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  await db.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), user.id, tokenHash, expiresAt, createdAt).run();
  return { token, expiresAt, user: publicUser(user) };
}

export async function registerAccount(db, env, body) {
  if (!env.REGISTRATION_INVITE_CODE) return { ok: false, status: 503, code: "REGISTRATION_DISABLED" };
  const inviteCode = String(body.inviteCode || "");
  if (!inviteCode || !(await constantTimeEqual(inviteCode, env.REGISTRATION_INVITE_CODE))) {
    return { ok: false, status: 403, code: "INVALID_INVITE_CODE" };
  }
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim().slice(0, 80);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return { ok: false, status: 400, code: "INVALID_EMAIL" };
  }
  if (password.length < 12 || password.length > 128) {
    return { ok: false, status: 400, code: "PASSWORD_LENGTH_INVALID" };
  }

  const id = crypto.randomUUID();
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const passwordHash = await derivePasswordHash(password, salt);
  const now = new Date().toISOString();
  try {
    await db.prepare(
      "INSERT INTO users (id, email, display_name, password_salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, email, displayName, salt, passwordHash, now, now).run();
  } catch {
    return { ok: false, status: 409, code: "ACCOUNT_UNAVAILABLE" };
  }
  return { ok: true, status: 201, session: await issueSession(db, { id, email, display_name: displayName, created_at: now }) };
}

export async function loginAccount(db, body) {
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!email || !password || email.length > 254 || password.length > 128) {
    return { ok: false, status: 400, code: "INVALID_CREDENTIALS" };
  }
  const user = await db.prepare(
    "SELECT id, email, display_name, password_salt, password_hash, created_at FROM users WHERE email = ? COLLATE NOCASE"
  ).bind(email).first();
  if (!user) return { ok: false, status: 401, code: "INVALID_CREDENTIALS" };
  const candidateHash = await derivePasswordHash(password, user.password_salt);
  if (!(await constantTimeEqual(candidateHash, user.password_hash))) {
    return { ok: false, status: 401, code: "INVALID_CREDENTIALS" };
  }
  return { ok: true, status: 200, session: await issueSession(db, user) };
}

export async function authenticateRequest(db, request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+([A-Za-z0-9_-]{32,})$/i);
  if (!match) return null;
  const tokenHash = await sha256(match[1]);
  const now = new Date().toISOString();
  const row = await db.prepare(
    "SELECT users.id, users.email, users.display_name, users.created_at FROM sessions " +
    "JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?"
  ).bind(tokenHash, now).first();
  return row ? { ...publicUser(row), tokenHash } : null;
}

export async function revokeSession(db, user) {
  await db.prepare("DELETE FROM sessions WHERE token_hash = ? AND user_id = ?")
    .bind(user.tokenHash, user.id).run();
}
