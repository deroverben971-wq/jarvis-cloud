import { authenticateRequest, loginAccount, registerAccount, revokeSession } from "./auth.js";
import { executeCollaborativeChat } from "./agents/orchestrator.js";
import { saveExplicitMemory } from "./services/memory.js";

const ALLOWED_ORIGINS = new Set([
  "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://localhost:5173"
]);

function headersFor(request, env) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  const origin = request.headers.get("Origin");
  if (origin && (ALLOWED_ORIGINS.has(origin) || origin === env.APP_ORIGIN)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
    headers.set("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    headers.set("access-control-allow-headers", "Authorization, Content-Type");
    headers.set("access-control-max-age", "600");
  }
  return headers;
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headersFor(request, env) });
}

function appError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 20000) throw appError("REQUEST_TOO_LARGE", 413);
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid");
    return body;
  } catch {
    throw appError("INVALID_JSON", 400);
  }
}

function requireDatabase(env) {
  if (!env.DB) throw appError("DATABASE_UNAVAILABLE", 503);
}

async function requireUser(request, env) {
  requireDatabase(env);
  const user = await authenticateRequest(env.DB, request);
  if (!user) throw appError("UNAUTHORIZED", 401);
  return user;
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: headersFor(request, env) });

  if (method === "GET" && path === "/health") {
    return json(request, env, {
      ok: true,
      service: "jarvis-standalone-api",
      version: "0.1.0",
      aiAvailable: Boolean(env.AI),
      databaseAvailable: Boolean(env.DB),
      model: env.JARVIS_AI_MODEL || "@cf/zai-org/glm-4.7-flash",
      freeOnly: true
    });
  }

  if (method === "POST" && path === "/v1/auth/register") {
    requireDatabase(env);
    const result = await registerAccount(env.DB, env, await readJson(request));
    if (!result.ok) return json(request, env, { ok: false, error: result.code }, result.status);
    return json(request, env, { ok: true, ...result.session }, result.status);
  }

  if (method === "POST" && path === "/v1/auth/login") {
    requireDatabase(env);
    const result = await loginAccount(env.DB, await readJson(request));
    if (!result.ok) return json(request, env, { ok: false, error: result.code }, result.status);
    return json(request, env, { ok: true, ...result.session }, result.status);
  }

  if (method === "POST" && path === "/v1/auth/logout") {
    const user = await requireUser(request, env);
    await revokeSession(env.DB, user);
    return json(request, env, { ok: true });
  }

  if (method === "GET" && path === "/v1/me") {
    const user = await requireUser(request, env);
    const { tokenHash, ...profile } = user;
    return json(request, env, { ok: true, user: profile });
  }

  if (method === "POST" && path === "/v1/chat") {
    const user = await requireUser(request, env);
    if (!env.AI) throw appError("AI_UNAVAILABLE", 503);
    const body = await readJson(request);
    const message = String(body.message || "").trim();
    if (!message || message.length > 8000) throw appError("MESSAGE_LENGTH_INVALID", 400);
    const conversationId = body.conversationId ? String(body.conversationId) : null;
    const result = await executeCollaborativeChat({ env, db: env.DB, userId: user.id, message, conversationId });
    return json(request, env, { ok: true, ...result });
  }

  if (method === "GET" && path === "/v1/conversations") {
    const user = await requireUser(request, env);
    const result = await env.DB.prepare(
      "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50"
    ).bind(user.id).all();
    return json(request, env, { ok: true, conversations: result.results || [] });
  }

  const messagesMatch = path.match(/^\/v1\/conversations\/([A-Za-z0-9_-]+)\/messages$/);
  if (method === "GET" && messagesMatch) {
    const user = await requireUser(request, env);
    const conversation = await env.DB.prepare(
      "SELECT id FROM conversations WHERE id = ? AND user_id = ?"
    ).bind(messagesMatch[1], user.id).first();
    if (!conversation) throw appError("CONVERSATION_NOT_FOUND", 404);
    const result = await env.DB.prepare(
      "SELECT id, role, agent_name, content, created_at FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at ASC LIMIT 200"
    ).bind(messagesMatch[1], user.id).all();
    return json(request, env, { ok: true, messages: result.results || [] });
  }

  if (method === "GET" && path === "/v1/tasks") {
    const user = await requireUser(request, env);
    const result = await env.DB.prepare(
      "SELECT id, conversation_id, goal, status, assigned_agent, result_json, error_code, created_at, updated_at, completed_at FROM tasks WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50"
    ).bind(user.id).all();
    return json(request, env, { ok: true, tasks: result.results || [] });
  }

  if (method === "GET" && path === "/v1/memories") {
    const user = await requireUser(request, env);
    const result = await env.DB.prepare(
      "SELECT id, kind, content, source, created_at, updated_at FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100"
    ).bind(user.id).all();
    return json(request, env, { ok: true, memories: result.results || [] });
  }

  if (method === "POST" && path === "/v1/memories") {
    const user = await requireUser(request, env);
    const body = await readJson(request);
    try {
      const memory = await saveExplicitMemory(env.DB, user.id, body.kind, body.content);
      return json(request, env, { ok: true, memory }, 201);
    } catch (error) {
      throw appError(error.code || "MEMORY_SAVE_FAILED", 400);
    }
  }

  const memoryMatch = path.match(/^\/v1\/memories\/([A-Za-z0-9_-]+)$/);
  if (method === "DELETE" && memoryMatch) {
    const user = await requireUser(request, env);
    const result = await env.DB.prepare(
      "DELETE FROM memories WHERE id = ? AND user_id = ?"
    ).bind(memoryMatch[1], user.id).run();
    if (!result.meta?.changes) throw appError("MEMORY_NOT_FOUND", 404);
    return json(request, env, { ok: true });
  }

  throw appError("NOT_FOUND", 404);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const code = error?.code || "INTERNAL_ERROR";
      return json(request, env, {
        ok: false,
        error: code,
        message: status >= 500 ? "A JARVIS service could not complete the request. No paid fallback is enabled." : undefined
      }, status);
    }
  }
};
