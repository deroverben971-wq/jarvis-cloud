import { authenticateRequest, loginAccount, registerAccount, revokeSession } from "./auth.js";
import { executeCollaborativeChat } from "./agents/orchestrator.js";
import { saveExplicitMemory } from "./services/memory.js";
import { normalizeReminderInput, processDueReminders } from "./services/reminders.js";
import { createApproval, listApprovals, resolveApproval } from "./services/approvals.js";

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
    headers.set("access-control-allow-headers", "Authorization, Content-Type, X-Audio-Duration");
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


function audioBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function reserveVoiceSeconds(db, seconds) {
  const usageDay = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const dailyLimitSeconds = 180;
  const row = await db.prepare(
    "INSERT INTO usage_daily (usage_day, ai_calls, audio_seconds, updated_at) VALUES (?, 0, ?, ?) " +
    "ON CONFLICT(usage_day) DO UPDATE SET audio_seconds = audio_seconds + excluded.audio_seconds, " +
    "updated_at = excluded.updated_at " +
    "WHERE usage_daily.audio_seconds + excluded.audio_seconds <= ? RETURNING audio_seconds"
  ).bind(usageDay, seconds, now, dailyLimitSeconds).first();

  if (!row) throw appError("VOICE_DAILY_LIMIT_REACHED", 429);
  return row.audio_seconds;
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
      speechRecognitionAvailable: Boolean(env.AI),
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
    const result = await loginAccount(
      env.DB,
      await readJson(request),
      request.headers.get("CF-Connecting-IP") || "unknown"
    );
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


  if (method === "POST" && path === "/v1/voice/transcribe") {
    const user = await requireUser(request, env);
    if (!env.AI) throw appError("AI_UNAVAILABLE", 503);

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 5 * 1024 * 1024) throw appError("AUDIO_TOO_LARGE", 413);

    const durationSeconds = Number(request.headers.get("X-Audio-Duration") || 0);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 60) {
      throw appError("AUDIO_DURATION_INVALID", 400);
    }

    const audio = await request.arrayBuffer();
    if (!audio.byteLength || audio.byteLength > 5 * 1024 * 1024) {
      throw appError("AUDIO_SIZE_INVALID", 400);
    }

    await reserveVoiceSeconds(env.DB, durationSeconds);
    try {
      const result = await env.AI.run("@cf/openai/whisper-large-v3-turbo", {
        audio: audioBufferToBase64(audio),
        task: "transcribe"
      });
      const transcript = String(result?.text || "").trim().slice(0, 8000);
      if (!transcript) throw appError("VOICE_TRANSCRIPT_EMPTY", 422);
      return json(request, env, {
        ok: true,
        transcript,
        durationSeconds,
        model: "@cf/openai/whisper-large-v3-turbo"
      });
    } catch (error) {
      if (error?.code) throw error;
      throw appError("VOICE_TRANSCRIPTION_FAILED", 502);
    }
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



  if (method === "GET" && path === "/v1/approvals") {
    const user = await requireUser(request, env);
    const approvals = await listApprovals(env.DB, user.id);
    return json(request, env, { ok: true, approvals });
  }

  if (method === "POST" && path === "/v1/approvals") {
    const user = await requireUser(request, env);
    const approval = await createApproval(env.DB, user.id, await readJson(request));
    return json(request, env, { ok: true, approval, actionExecuted: false }, 201);
  }

  const approvalPath = path.split("/");
  if (method === "POST" && approvalPath.length === 5 &&
      approvalPath[1] === "v1" && approvalPath[2] === "approvals" &&
      approvalPath[4] === "decision" && /^[A-Za-z0-9_-]+$/.test(approvalPath[3])) {
    const user = await requireUser(request, env);
    const body = await readJson(request);
    const approval = await resolveApproval(env.DB, user.id, approvalPath[3], body.decision);
    if (!approval) throw appError("APPROVAL_NOT_FOUND", 404);
    return json(request, env, { ok: true, approval, actionExecuted: false });
  }

  if (method === "GET" && path === "/v1/reminders") {
    const user = await requireUser(request, env);
    const result = await env.DB.prepare(
      "SELECT id, payload_json, run_at, status, created_at, updated_at FROM scheduled_jobs " +
      "WHERE user_id = ? AND job_type = 'reminder' ORDER BY run_at ASC LIMIT 100"
    ).bind(user.id).all();
    const reminders = (result.results || []).map((row) => {
      let payload = {};
      try { payload = JSON.parse(row.payload_json || "{}"); } catch { /* Ignore malformed legacy payloads. */ }
      return { id: row.id, title: String(payload.title || "Reminder"), body: String(payload.body || ""), run_at: row.run_at, status: row.status, created_at: row.created_at, updated_at: row.updated_at };
    });
    return json(request, env, { ok: true, reminders });
  }

  if (method === "POST" && path === "/v1/reminders") {
    const user = await requireUser(request, env);
    const body = await readJson(request);
    let reminder;
    try {
      reminder = normalizeReminderInput(body);
    } catch (error) {
      throw appError(error.code || "REMINDER_INPUT_INVALID", 400);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO scheduled_jobs (id, user_id, job_type, payload_json, run_at, status, created_at, updated_at) " +
      "VALUES (?, ?, 'reminder', ?, ?, 'scheduled', ?, ?)"
    ).bind(id, user.id, JSON.stringify({ title: reminder.title, body: reminder.body }), reminder.runAt, now, now).run();
    return json(request, env, { ok: true, reminder: { id, title: reminder.title, body: reminder.body, run_at: reminder.runAt, status: "scheduled", created_at: now, updated_at: now } }, 201);
  }

  const reminderMatch = path.match(/^\/v1\/reminders\/([A-Za-z0-9_-]+)$/);
  if (method === "DELETE" && reminderMatch) {
    const user = await requireUser(request, env);
    const result = await env.DB.prepare(
      "UPDATE scheduled_jobs SET status = 'cancelled', updated_at = ? " +
      "WHERE id = ? AND user_id = ? AND job_type = 'reminder' AND status = 'scheduled'"
    ).bind(new Date().toISOString(), reminderMatch[1], user.id).run();
    if (!result.meta?.changes) throw appError("REMINDER_NOT_FOUND_OR_ALREADY_DUE", 404);
    return json(request, env, { ok: true });
  }

  if (method === "GET" && path === "/v1/notifications") {
    const user = await requireUser(request, env);
    const unreadOnly = url.searchParams.get("unread") === "1";
    const result = await env.DB.prepare(
      "SELECT id, scheduled_job_id, title, body, created_at, read_at FROM notifications " +
      "WHERE user_id = ? " + (unreadOnly ? "AND read_at IS NULL " : "") +
      "ORDER BY created_at DESC LIMIT 100"
    ).bind(user.id).all();
    return json(request, env, { ok: true, notifications: result.results || [] });
  }

  const notificationReadMatch = path.match(/^\/v1\/notifications\/([A-Za-z0-9_-]+)\/read$/);
  if (method === "POST" && notificationReadMatch) {
    const user = await requireUser(request, env);
    const result = await env.DB.prepare(
      "UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?"
    ).bind(new Date().toISOString(), notificationReadMatch[1], user.id).run();
    if (!result.meta?.changes) throw appError("NOTIFICATION_NOT_FOUND", 404);
    return json(request, env, { ok: true });
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
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(processDueReminders(env).catch((error) => {
      console.error("JARVIS reminder cron failed:", error?.code || "CRON_FAILED");
    }));
  },

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
