const HELP = [
  "🤖 JARVIS CLOUD — PHASE 2",
  "",
  "Commands:",
  "/schedule — reminders due today",
  "/reminders — list upcoming reminders",
  "/remind YYYY-MM-DD HH:MM task — add a reminder (Manila time)",
  "/cancel ID — cancel a reminder",
  "/help — show this message",
  "",
  "Example:",
  "/remind 2026-10-25 18:00 Finish homework",
  "",
  "Times use Asia/Manila (PHT). This cloud version handles reminders and schedule queries; it is not the local Ollama AI."
].join("\n");

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

async function telegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
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
  // Telegram messages are limited to 4096 characters.
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
  // Manila is UTC+8 and does not currently observe daylight saving time.
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
  const lines = items.map(r => `#${r.id} · ${formatManila(r.due_at)}\n   ${r.task}`);
  await sendText(env, chatId, heading + "\n\n" + lines.join("\n\n"));
}

function isCloudReminderMessage(message) {
  const raw = (message.text || "").trim();
  const text = raw.toLowerCase();
  return text === "/start" || text === "/help" || text === "help" ||
    text === "/schedule" || text === "/reminders" || text.startsWith("/remind ") ||
    text.startsWith("/cancel ") || text === "show my reminders" || text === "list reminders" ||
    /what('?s| is) my schedule (for )?today\??/.test(text) ||
    /what do i have today\??/.test(text);
}

async function enqueueForLocalJarvis(env, message, updateId) {
  const chatId = String(message.chat?.id ?? "");
  const body = (message.text || "").trim();
  if (!chatId || chatId !== String(env.TELEGRAM_CHAT_ID) || !body) return;
  await env.DB.prepare(
    "INSERT INTO bridge_queue (update_id, chat_id, message_text, created_at, status) VALUES (?, ?, ?, ?, 'pending')"
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
  if (text.startsWith("/remind ")) {
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
    await sendText(env, chatId, `✅ Reminder saved!\nID: #${id}\nTask: ${match[3].trim()}\nWhen: ${formatManila(due.toISOString())}`);
    return;
  }
  if (text.startsWith("/cancel ")) {
    const id = Number(raw.split(/\s+/)[1]);
    if (!Number.isSafeInteger(id) || id < 1) {
      await sendText(env, chatId, "Use /cancel ID — for example, /cancel 3");
      return;
    }
    const result = await env.DB.prepare(
      "UPDATE reminders SET cancelled_at = ? WHERE id = ? AND chat_id = ? AND sent_at IS NULL AND cancelled_at IS NULL"
    ).bind(new Date().toISOString(), id, chatId).run();
    await sendText(env, chatId, result.meta?.changes ? `🗑️ Reminder #${id} cancelled.` : `I couldn't find an active reminder #${id}.`);
    return;
  }

  await sendText(env, chatId, "I can manage your cloud reminders and today's schedule. Send /help to see commands. For full AI conversation, use your Windows JARVIS bot.");
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
      return json({ ok: false, error: "Worker configuration incomplete" }, 500);
    }
    let update;
    try {
      update = await request.json();
    } catch {
      return json({ ok: false, error: "Invalid JSON" }, 400);
    }
    try {
      if (update.update_id !== undefined) {
        const seen = await env.DB.prepare("INSERT OR IGNORE INTO processed_updates (update_id, processed_at) VALUES (?, ?)")
          .bind(update.update_id, new Date().toISOString()).run();
        if (!seen.meta?.changes) return json({ ok: true, duplicate: true });
      }
      if (update.message && update.message.text) {
        if (isCloudReminderMessage(update.message)) await handleMessage(env, update.message);
        else await enqueueForLocalJarvis(env, update.message, update.update_id);
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
          `⏰ JARVIS REMINDER\n\n${reminder.task}\n\nScheduled: ${formatManila(reminder.due_at)}`);
        await env.DB.prepare("UPDATE reminders SET sent_at = ? WHERE id = ? AND sent_at IS NULL")
          .bind(new Date().toISOString(), reminder.id).run();
      } catch (error) {
        console.error("Could not deliver reminder", reminder.id, error?.message || "unknown error");
      }
    }
  }
};