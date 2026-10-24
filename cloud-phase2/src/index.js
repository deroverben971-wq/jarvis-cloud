const HELP = [
  "🤖 JARVIS CLOUD — PHASE 2",
  "",
  "Cloud AI works while your PC is off (when the Workers AI binding is enabled).",
  "",
  "REMINDERS",
  "/schedule — reminders due today",
  "/reminders — list upcoming reminders",
  "/remind YYYY-MM-DD HH:MM task — add a reminder (Manila time)",
  "/cancel ID — cancel a reminder",
  "",
  "CLOUD MEMORY",
  "/remember fact — save a long-term fact",
  "/memories — list saved facts",
  "/forget ID — delete one saved fact",
  "/history — show recent cloud conversation history",
  "/forgetme — erase cloud conversation history and saved facts",
  "",
  "/help — show this message",
  "",
  "Example: /remind 2026-10-25 18:00 Finish homework",
  "Times use Asia/Manila (PHT). Cloud AI uses Cloudflare Workers AI. Local Ollama is an optional fallback when the bridge is online."
].join("\n");

const CLOUD_AI_MODEL = "@cf/zai-org/glm-4.7-flash";
const SYSTEM_PROMPT = [
  "You are JARVIS, a helpful personal AI assistant.",
  "Be friendly, practical, clear, and honest. Do not claim to have taken an action unless the system actually confirms it.",
  "Use the saved facts and recent conversation context when relevant. If information is not in the context, do not pretend to remember it.",
  "You are running in the cloud. Do not claim you can directly access the user's Windows computer, local files, local Ollama, or other devices.",
  "Keep ordinary replies reasonably concise unless the user asks for detail."
].join(" ");

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function telegram(env, method, payload) {
  const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    console.error("Telegram API request failed", method, response.status, data.description || "unknown error");
    throw new Error("Telegram API request failed");
  }
  return data;
}

async function sendText(env, chatId, text) {
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0, 3900),
    disable_web_page_preview: true
  });
}

function localDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const out = {};
  for (const p of parts) if (p.type !== "literal") out[p.type] = p.value;
  return { year: Number(out.year), month: Number(out.month), day: Number(out.day) };
}

function manilaInputToUtc(dateText, timeText) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  const t = /^(\d{2}):(\d{2})$/.exec(timeText);
  if (!d || !t) return null;
  const year = Number(d[1]), month = Number(d[2]), day = Number(d[3]);
  const hour = Number(t[1]), minute = Number(t[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const utc = new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return utc;
}

function formatManila(iso) {
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true
  }).format(new Date(iso));
}

async function showReminders(env, chatId, todayOnly = false) {
  const nowIso = new Date().toISOString();
  let rows;
  if (todayOnly) {
    const p = localDateParts();
    const tomorrowUtc = new Date(Date.UTC(p.year, p.month - 1, p.day + 1, -8, 0)).toISOString();
    const todayUtc = new Date(Date.UTC(p.year, p.month - 1, p.day, -8, 0)).toISOString();
    rows = await env.DB.prepare(
      "SELECT id, task, due_at FROM reminders WHERE chat_id = ? AND sent_at IS NULL AND cancelled_at IS NULL AND due_at >= ? AND due_at < ? ORDER BY due_at LIMIT 30"
    ).bind(String(chatId), todayUtc, tomorrowUtc).all();
  } else {
    rows = await env.DB.prepare(
      "SELECT id, task, due_at FROM reminders WHERE chat_id = ? AND sent_at IS NULL AND cancelled_at IS NULL AND due_at >= ? ORDER BY due_at LIMIT 30"
    ).bind(String(chatId), nowIso).all();
  }
  const items = rows.results || [];
  if (!items.length) {
    await sendText(env, chatId, todayOnly ? "📅 You have no upcoming reminders for today." : "📭 You have no upcoming reminders.");
    return;
  }
  const heading = todayOnly ? "📅 YOUR SCHEDULE TODAY" : "🗒️ UPCOMING REMINDERS";
  const lines = items.map(r => "#" + r.id + " · " + formatManila(r.due_at) + "\n   " + r.task);
  await sendText(env, chatId, heading + "\n\n" + lines.join("\n\n"));
}

function isCloudCommand(message) {
  const text = (message.text || "").trim().toLowerCase();
  return text === "/start" || text === "/help" || text === "help" ||
    text === "/schedule" || text === "/reminders" ||
    text === "/remind" || text.startsWith("/remind ") || text === "/cancel" || text.startsWith("/cancel ") ||
    text.startsWith("/remember ") || text === "/remember" || text === "/memories" ||
    text === "/forget" || text.startsWith("/forget ") || text === "/history" || text === "/forgetme" ||
    text === "show my reminders" || text === "list reminders" ||
    /what('?s| is) my schedule (for )?today\??/.test(text) ||
    /what do i have today\??/.test(text);
}

async function enqueueForLocalJarvis(env, message, updateId) {
  const chatId = String(message.chat?.id ?? "");
  const body = (message.text || "").trim();
  if (!chatId || chatId !== String(env.TELEGRAM_CHAT_ID) || !body || updateId === undefined) return;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO bridge_queue (update_id, chat_id, message_text, created_at, status) VALUES (?, ?, ?, ?, 'pending')"
  ).bind(updateId, chatId, body.slice(0, 4000), new Date().toISOString()).run();
}

async function handleMessage(env, message) {
  const chatId = String(message.chat?.id ?? "");
  if (!chatId || chatId !== String(env.TELEGRAM_CHAT_ID)) return;
  const raw = (message.text || "").trim();
  const text = raw.toLowerCase();

  if (text === "/start" || text === "/help" || text === "help") {
    await sendText(env, chatId, HELP);
    return;
  }
  if (text === "/schedule" || /what('?s| is) my schedule (for )?today\??/.test(text) || /what do i have today\??/.test(text)) {
    await showReminders(env, chatId, true);
    return;
  }
  if (text === "/reminders" || text === "show my reminders" || text === "list reminders") {
    await showReminders(env, chatId, false);
    return;
  }
  if (text.startsWith("/remind")) {
    const match = /^\/remind\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([\s\S]{1,300})$/i.exec(raw);
    if (!match) {
      await sendText(env, chatId, "Use this format (Manila time):\n/remind YYYY-MM-DD HH:MM task\n\nExample:\n/remind 2026-10-25 18:00 Study for science");
      return;
    }
    const due = manilaInputToUtc(match[1], match[2]);
    if (!due || due.getTime() <= Date.now()) {
      await sendText(env, chatId, "That date/time is invalid or already passed. Use a future date and 24-hour time in Manila time.");
      return;
    }
    const result = await env.DB.prepare(
      "INSERT INTO reminders (chat_id, task, due_at, created_at) VALUES (?, ?, ?, ?)"
    ).bind(chatId, match[3].trim(), due.toISOString(), new Date().toISOString()).run();
    const id = result.meta?.last_row_id;
    await sendText(env, chatId, "✅ Reminder saved!\nID: #" + id + "\nTask: " + match[3].trim() + "\nWhen: " + formatManila(due.toISOString()));
    return;
  }
  if (text.startsWith("/cancel")) {
    const id = Number(raw.split(/\s+/)[1]);
    if (!Number.isSafeInteger(id) || id < 1) {
      await sendText(env, chatId, "Use /cancel ID — for example, /cancel 3");
      return;
    }
    const result = await env.DB.prepare(
      "UPDATE reminders SET cancelled_at = ? WHERE id = ? AND chat_id = ? AND sent_at IS NULL AND cancelled_at IS NULL"
    ).bind(new Date().toISOString(), id, chatId).run();
    await sendText(env, chatId, result.meta?.changes ? "🗑️ Reminder #" + id + " cancelled." : "I couldn't find an active reminder #" + id + ".");
    return;
  }
  if (text === "/remember" || text.startsWith("/remember ")) {
    const fact = raw.slice("/remember".length).trim();
    if (!fact) {
      await sendText(env, chatId, "Usage: /remember I prefer short answers");
      return;
    }
    if (fact.length > 1000) {
      await sendText(env, chatId, "Keep each saved fact under 1000 characters.");
      return;
    }
    await env.DB.prepare("INSERT INTO cloud_facts (chat_id, fact, created_at) VALUES (?, ?, ?)")
      .bind(chatId, fact, new Date().toISOString()).run();
    await sendText(env, chatId, "✅ Saved to your cloud JARVIS memory.");
    return;
  }
  if (text === "/memories") {
    const rows = await env.DB.prepare("SELECT id, fact FROM cloud_facts WHERE chat_id = ? ORDER BY id DESC LIMIT 30")
      .bind(chatId).all();
    const facts = rows.results || [];
    await sendText(env, chatId, facts.length ? "🧠 SAVED CLOUD FACTS\n\n" + facts.map(r => "#" + r.id + " · " + r.fact).join("\n") : "No saved cloud facts yet. Use /remember fact to save one.");
    return;
  }
  if (text.startsWith("/forget ")) {
    const idText = raw.split(/\s+/)[1] || "";
    const id = Number(idText);
    if (!Number.isSafeInteger(id) || id < 1) {
      await sendText(env, chatId, "Usage: /forget ID — for example, /forget 3");
      return;
    }
    const result = await env.DB.prepare("DELETE FROM cloud_facts WHERE id = ? AND chat_id = ?")
      .bind(id, chatId).run();
    await sendText(env, chatId, result.meta?.changes ? "🗑️ Saved fact #" + id + " deleted." : "I couldn't find saved fact #" + id + ".");
    return;
  }
  if (text === "/history") {
    const rows = await env.DB.prepare("SELECT role, content, created_at FROM cloud_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 10")
      .bind(chatId).all();
    const messages = (rows.results || []).reverse();
    await sendText(env, chatId, messages.length
      ? "🗂️ RECENT CLOUD CHAT HISTORY\n\n" + messages.map(m => (m.role === "user" ? "You" : "JARVIS") + ": " + m.content).join("\n\n").slice(-3600)
      : "No cloud AI conversation history yet.");
    return;
  }
  if (text === "/forgetme") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM cloud_messages WHERE chat_id = ?").bind(chatId),
      env.DB.prepare("DELETE FROM cloud_facts WHERE chat_id = ?").bind(chatId)
    ]);
    await sendText(env, chatId, "🧹 Your cloud conversation history and saved cloud facts have been erased. This does not change the separate SQLite memory file on your Windows PC.");
    return;
  }
}

function extractAIText(result) {
  if (typeof result === "string") return result.trim();
  if (!result || typeof result !== "object") return "";
  if (typeof result.response === "string") return result.response.trim();
  if (typeof result.output_text === "string") return result.output_text.trim();
  if (typeof result.text === "string") return result.text.trim();
  if (result.message && typeof result.message.content === "string") return result.message.content.trim();
  if (result.choices && result.choices[0] && result.choices[0].message && typeof result.choices[0].message.content === "string") {
    return result.choices[0].message.content.trim();
  }
  return "";
}

async function handleCloudChat(env, message, updateId) {
  const chatId = String(message.chat?.id ?? "");
  const userText = (message.text || "").trim().slice(0, 4000);
  if (!chatId || chatId !== String(env.TELEGRAM_CHAT_ID) || !userText) return;

  const historyRows = await env.DB.prepare(
    "SELECT role, content FROM cloud_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 12"
  ).bind(chatId).all();
  const history = (historyRows.results || []).reverse().map(m => ({
    role: m.role,
    content: String(m.content).slice(-3000)
  }));
  const factsRows = await env.DB.prepare(
    "SELECT fact FROM cloud_facts WHERE chat_id = ? ORDER BY id DESC LIMIT 40"
  ).bind(chatId).all();
  const facts = (factsRows.results || []).map(r => "- " + String(r.fact).slice(0, 1000)).join("\n").slice(0, 8000);
  const system = SYSTEM_PROMPT + "\n\nSaved facts for this user:\n" + (facts || "(No saved facts yet.)");
  let answer;

  try {
    const result = await env.AI.run(CLOUD_AI_MODEL, {
      messages: [{ role: "system", content: system }].concat(history, [{ role: "user", content: userText }]),
      max_tokens: 600,
      temperature: 0.6
    });
    answer = extractAIText(result);
    if (!answer) throw new Error("The cloud model returned no text.");
  } catch (error) {
    console.error("Cloud AI inference failed:", error?.message || "unknown error");
    await enqueueForLocalJarvis(env, message, updateId);
    await sendText(env, chatId, "☁️ Cloud AI is temporarily unavailable. I queued your message for local JARVIS if your PC and bridge are online; otherwise, try again shortly.");
    return;
  }

  const timestamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO cloud_messages (chat_id, role, content, created_at) VALUES (?, 'user', ?, ?)")
      .bind(chatId, userText, timestamp),
    env.DB.prepare("INSERT INTO cloud_messages (chat_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)")
      .bind(chatId, answer, timestamp)
  ]);
  await sendText(env, chatId, answer);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response("JARVIS Cloud Phase 2 is online.", { status: 200 });
    }
    if (request.method === "GET" && url.pathname === "/bridge/next") {
      if (!env.JARVIS_BRIDGE_SECRET || request.headers.get("X-Jarvis-Bridge-Secret") !== env.JARVIS_BRIDGE_SECRET) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      const row = await env.DB.prepare(
        "SELECT id, chat_id, message_text FROM bridge_queue WHERE status = 'pending' ORDER BY id LIMIT 1"
      ).first();
      if (!row) return json({ ok: true, job: null });
      const claimed = await env.DB.prepare(
        "UPDATE bridge_queue SET status = 'processing', attempts = attempts + 1 WHERE id = ? AND status = 'pending'"
      ).bind(row.id).run();
      if (!claimed.meta?.changes) return json({ ok: true, job: null });
      return json({ ok: true, job: { id: row.id, chat_id: row.chat_id, text: row.message_text } });
    }
    if (request.method === "POST" && url.pathname === "/bridge/reply") {
      if (!env.JARVIS_BRIDGE_SECRET || request.headers.get("X-Jarvis-Bridge-Secret") !== env.JARVIS_BRIDGE_SECRET) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
      if (!Number.isSafeInteger(body.id) || body.id < 1 || typeof body.text !== "string") {
        return json({ ok: false, error: "Invalid reply payload" }, 400);
      }
      const row = await env.DB.prepare("SELECT chat_id, status FROM bridge_queue WHERE id = ?").bind(body.id).first();
      if (!row || row.status !== "processing") return json({ ok: false, error: "Job not found or not processing" }, 404);
      await sendText(env, row.chat_id, body.text);
      await env.DB.prepare("UPDATE bridge_queue SET status = 'done', completed_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), body.id).run();
      return json({ ok: true });
    }
    if (request.method !== "POST" || url.pathname !== "/telegram") {
      return json({ ok: false, error: "Not found" }, 404);
    }
    const supplied = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (!env.TELEGRAM_WEBHOOK_SECRET || supplied !== env.TELEGRAM_WEBHOOK_SECRET) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.DB) {
      return json({ ok: false, error: "Worker configuration incomplete", detail: "Check TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and DB binding." }, 500);
    }
    let update;
    try {
      update = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }
    try {
      if (update.update_id !== undefined) {
        const seen = await env.DB.prepare("SELECT update_id FROM processed_updates WHERE update_id = ?")
          .bind(update.update_id).first();
        if (seen) return json({ ok: true, duplicate: true });
      }
      if (update.message && update.message.text) {
        const message = update.message;
        if (String(message.chat?.id ?? "") !== String(env.TELEGRAM_CHAT_ID)) {
          // Ignore messages from chats that are not explicitly authorized.
        } else if (isCloudCommand(message)) {
          await handleMessage(env, message);
        } else if (env.AI) {
          await handleCloudChat(env, message, update.update_id);
        } else {
          await enqueueForLocalJarvis(env, message, update.update_id);
        }
      }
      if (update.update_id !== undefined) {
        await env.DB.prepare("INSERT OR IGNORE INTO processed_updates (update_id, processed_at) VALUES (?, ?)")
          .bind(update.update_id, new Date().toISOString()).run();
      }
      return json({ ok: true });
    } catch (error) {
      console.error("Update handling failed:", error?.message || "unknown error");
      return json({ ok: false, error: "Update handling failed" }, 500);
    }
  },

  async scheduled(controller, env) {
    if (!env.DB || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      console.error("Reminder checker configuration incomplete.");
      return;
    }
    const now = new Date().toISOString();
    const due = await env.DB.prepare(
      "SELECT id, chat_id, task, due_at FROM reminders WHERE sent_at IS NULL AND cancelled_at IS NULL AND due_at <= ? ORDER BY due_at LIMIT 25"
    ).bind(now).all();

    for (const reminder of due.results || []) {
      try {
        await sendText(env, reminder.chat_id,
          "⏰ JARVIS REMINDER\n\n" + reminder.task + "\n\nScheduled: " + formatManila(reminder.due_at));
        await env.DB.prepare("UPDATE reminders SET sent_at = ? WHERE id = ? AND sent_at IS NULL")
          .bind(new Date().toISOString(), reminder.id).run();
      } catch (error) {
        console.error("Could not deliver reminder", reminder.id, error?.message || "unknown error");
      }
    }
  }
};
