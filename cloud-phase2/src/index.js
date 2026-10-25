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
  "/remindcall YYYY-MM-DD HH:MM task — reminder plus a phone call (optional paid provider)",
  "",
  "GOOGLE CALENDAR",
  "/calendar — list the next 7 days",
  "/event YYYY-MM-DD HH:MM duration title — add an event (Manila time)",
  "/alarm YYYY-MM-DD HH:MM title — Calendar popup alert 5 minutes early (not an Android Clock alarm)",
  "",
  "PHONE CALLS (optional; disabled by default and may cost money)",
  "/callme message — request an immediate phone call",
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
  "Examples: /remind 2026-10-25 18:00 Finish homework",
  "/event 2026-10-26 15:00 60 Science project meeting",
  "/alarm 2026-10-27 06:30 Wake up",
  "Times use Asia/Manila (PHT). Calendar integration needs a Google Apps Script bridge. Actual phone calls need an optional external voice provider."
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


async function callGoogleCalendar(env, payload) {
  const endpoint = String(env.GOOGLE_CALENDAR_WEBAPP_URL || "").trim();
  const secret = String(env.GOOGLE_CALENDAR_SHARED_SECRET || "");
  if (!endpoint || !secret) {
    return { ok: false, setupMissing: true, error: "Google Calendar is not connected." };
  }
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "follow",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, secret: secret })
    });
  } catch (error) {
    console.error("Google Calendar bridge request failed:", error?.name || "unknown");
    return { ok: false, error: "Could not reach the Google Calendar bridge." };
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.ok !== true) {
    console.error("Google Calendar bridge returned an unsuccessful response:", response.status);
    return { ok: false, error: (data && data.error) ? String(data.error).slice(0, 180) : "Google Calendar rejected the request." };
  }
  return data;
}

function phoneCallsConfigured(env) {
  return String(env.JARVIS_CALLS_ENABLED || "").toLowerCase() === "true" &&
    !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN &&
    !!env.TWILIO_FROM_NUMBER && !!env.JARVIS_CALL_TO_NUMBER;
}

function escapeXml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

async function placePhoneCall(env, chatId, spokenText, purpose) {
  if (!phoneCallsConfigured(env)) {
    return { ok: false, error: "Phone calls are disabled or not configured. Calls use an external voice provider and may cost money; use /remind for a free Telegram reminder." };
  }
  const to = String(env.JARVIS_CALL_TO_NUMBER).trim();
  const from = String(env.TWILIO_FROM_NUMBER).trim();
  if (!/^\+[1-9]\d{7,14}$/.test(to) || !/^\+[1-9]\d{7,14}$/.test(from)) {
    return { ok: false, error: "Phone call setup needs the destination and caller ID in international E.164 format." };
  }
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM phone_call_log WHERE chat_id = ? AND created_at >= ?"
  ).bind(String(chatId), since).first();
  if (Number(recent?.total || 0) >= 3) {
    return { ok: false, error: "Safety limit reached: JARVIS allows at most 3 call requests per rolling 24 hours." };
  }
  const latest = await env.DB.prepare(
    "SELECT created_at FROM phone_call_log WHERE chat_id = ? ORDER BY id DESC LIMIT 1"
  ).bind(String(chatId)).first();
  if (latest && now.getTime() - new Date(latest.created_at).getTime() < 10 * 60 * 1000) {
    return { ok: false, error: "Please wait at least 10 minutes between JARVIS call requests." };
  }

  const inserted = await env.DB.prepare(
    "INSERT INTO phone_call_log (chat_id, created_at, status, purpose) VALUES (?, ?, 'requested', ?)"
  ).bind(String(chatId), now.toISOString(), String(purpose || "manual").slice(0, 20)).run();
  const logId = inserted.meta?.last_row_id;
  const speech = String(spokenText || "Hello. This is JARVIS calling as requested.").trim().slice(0, 500);
  const twiml = '<Response><Say language="en-US">' + escapeXml(speech) + '</Say></Response>';
  const form = new URLSearchParams({ To: to, From: from, Twiml: twiml, TimeLimit: "60" });
  try {
    const response = await fetch(
      "https://api.twilio.com/2010-04-01/Accounts/" + String(env.TWILIO_ACCOUNT_SID).trim() + "/Calls.json",
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + btoa(String(env.TWILIO_ACCOUNT_SID).trim() + ":" + String(env.TWILIO_AUTH_TOKEN)),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
      }
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.sid) {
      await env.DB.prepare("UPDATE phone_call_log SET status = 'failed' WHERE id = ?").bind(logId).run();
      console.error("Phone call provider rejected call request:", response.status);
      return { ok: false, error: "The phone provider did not start the call. Check its account, verified caller ID, and billing setup." };
    }
    await env.DB.prepare("UPDATE phone_call_log SET status = 'initiated', call_sid = ? WHERE id = ?")
      .bind(String(data.sid), logId).run();
    return { ok: true, callSid: String(data.sid) };
  } catch (error) {
    await env.DB.prepare("UPDATE phone_call_log SET status = 'failed' WHERE id = ?").bind(logId).run();
    console.error("Phone call request failed:", error?.name || "unknown");
    return { ok: false, error: "Could not reach the phone provider. No successful call was confirmed." };
  }
}

function isCloudCommand(message) {
  const text = (message.text || "").trim().toLowerCase();
  return text === "/start" || text === "/help" || text === "help" ||
    text === "/schedule" || text === "/reminders" ||
    text === "/remind" || text.startsWith("/remind ") || text === "/cancel" || text.startsWith("/cancel ") ||
    text === "/remindcall" || text.startsWith("/remindcall ") ||
    text === "/calendar" || text === "/event" || text.startsWith("/event ") ||
    text === "/alarm" || text.startsWith("/alarm ") ||
    text === "/callme" || text.startsWith("/callme ") ||
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

  if (text === "/calendar") {
    const result = await callGoogleCalendar(env, { action: "list_events", days: 7 });
    if (!result.ok) {
      await sendText(env, chatId, result.setupMissing
        ? "📅 Google Calendar isn't connected yet. Finish the Google Apps Script setup from the JARVIS Calendar integration guide."
        : "📅 Calendar request failed: " + result.error);
      return;
    }
    const events = result.events || [];
    if (!events.length) {
      await sendText(env, chatId, "📅 No Google Calendar events in the next 7 days.");
      return;
    }
    const lines = events.slice(0, 15).map(event => {
      const startLabel = event.allDay || /^\\d{4}-\\d{2}-\\d{2}$/.test(String(event.start || ""))
        ? "All day " + String(event.start || "").slice(0, 10)
        : formatManila(event.start);
      return "• " + startLabel + " — " + String(event.title || "(Untitled event)") +
        (event.location ? " (" + String(event.location).slice(0, 100) + ")" : "");
    });
    await sendText(env, chatId, "📅 GOOGLE CALENDAR — NEXT 7 DAYS\n\n" + lines.join("\n"));
    return;
  }

  if (text === "/event" || text.startsWith("/event ") || text === "/alarm" || text.startsWith("/alarm ")) {
    const isAlarmAlert = text === "/alarm" || text.startsWith("/alarm ");
    const match = isAlarmAlert
      ? /^\/alarm\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([\s\S]{1,160})$/i.exec(raw)
      : /^\/event\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(\d{1,3})\s+([\s\S]{1,160})$/i.exec(raw);
    if (!match) {
      await sendText(env, chatId, isAlarmAlert
        ? "Use: /alarm YYYY-MM-DD HH:MM title\nThis adds a Google Calendar event with a popup alert 5 minutes before it; it does not set Android Clock's native alarm."
        : "Use: /event YYYY-MM-DD HH:MM duration title\nExample: /event 2026-10-26 15:00 60 Science project meeting\nTimes use Manila time; duration must be 15–480 minutes.");
      return;
    }
    const start = manilaInputToUtc(match[1], match[2]);
    const duration = isAlarmAlert ? 5 : Number(match[3]);
    const title = (isAlarmAlert ? match[3] : match[4]).trim();
    if (!start || start.getTime() <= Date.now() || (!isAlarmAlert && (!Number.isInteger(duration) || duration < 15 || duration > 480))) {
      await sendText(env, chatId, "That date/time or duration is invalid. Use a future Manila date/time and a duration from 15 to 480 minutes for /event.");
      return;
    }
    const end = new Date(start.getTime() + duration * 60 * 1000);
    const result = await callGoogleCalendar(env, {
      action: "create_event",
      title: title,
      start: start.toISOString(),
      end: end.toISOString(),
      popupReminderMinutes: isAlarmAlert ? 5 : undefined
    });
    if (!result.ok) {
      await sendText(env, chatId, result.setupMissing
        ? "📅 Google Calendar isn't connected yet. No event was created."
        : "📅 I couldn't create that calendar event: " + result.error);
      return;
    }
    const event = result.event || {};
    await sendText(env, chatId, (isAlarmAlert ? "🔔 Calendar alert created!" : "✅ Google Calendar event created!") +
      "\nTitle: " + String(event.title || title) +
      "\nWhen: " + formatManila(event.start || start.toISOString()) +
      (isAlarmAlert ? "\nPopup alert: 5 minutes before. This is a Calendar notification, not an Android Clock alarm." : ""));
    return;
  }

  if (text === "/callme" || text.startsWith("/callme ")) {
    const spoken = raw.slice("/callme".length).trim() ||
      "Hello. This is JARVIS calling as requested. This is a test call.";
    const result = await placePhoneCall(env, chatId, spoken, "manual");
    if (!result.ok) {
      await sendText(env, chatId, "📞 No call was placed. " + result.error);
      return;
    }
    await sendText(env, chatId, "📞 JARVIS asked the phone provider to call you. If the call doesn't arrive, check the provider's call logs and verified caller ID. Calls may incur charges.");
    return;
  }

  if (text === "/remindcall" || text.startsWith("/remindcall ")) {
    if (!phoneCallsConfigured(env)) {
      await sendText(env, chatId, "📞 Phone-call reminders aren't enabled. No reminder was created. This optional feature needs a configured voice provider and can cost money. Use /remind for the free Telegram reminder instead.");
      return;
    }
    const match = /^\/remindcall\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+([\s\S]{1,300})$/i.exec(raw);
    if (!match) {
      await sendText(env, chatId, "Use: /remindcall YYYY-MM-DD HH:MM task\nExample: /remindcall 2026-10-26 18:00 Call me to study\nThis creates a Telegram reminder plus a phone call at the due time.");
      return;
    }
    const due = manilaInputToUtc(match[1], match[2]);
    if (!due || due.getTime() <= Date.now()) {
      await sendText(env, chatId, "That date/time is invalid or already passed. Use a future Manila date/time.");
      return;
    }
    const task = match[3].trim();
    const result = await env.DB.prepare(
      "INSERT INTO reminders (chat_id, task, due_at, created_at) VALUES (?, ?, ?, ?)"
    ).bind(chatId, task, due.toISOString(), new Date().toISOString()).run();
    const reminderId = result.meta?.last_row_id;
    await env.DB.prepare(
      "INSERT INTO phone_call_reminders (reminder_id, chat_id, status, created_at) VALUES (?, ?, 'pending', ?)"
    ).bind(reminderId, chatId, new Date().toISOString()).run();
    await sendText(env, chatId, "✅ Phone-call reminder saved!\nID: #" + reminderId +
      "\nTask: " + task + "\nWhen: " + formatManila(due.toISOString()) +
      "\nAt the due time, JARVIS will send the Telegram reminder and request a phone call. Provider charges may apply.");
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
      "SELECT r.id, r.chat_id, r.task, r.due_at, p.status AS call_status FROM reminders r LEFT JOIN phone_call_reminders p ON p.reminder_id = r.id WHERE r.sent_at IS NULL AND r.cancelled_at IS NULL AND r.due_at <= ? ORDER BY r.due_at LIMIT 25"
    ).bind(now).all();

    for (const reminder of due.results || []) {
      try {
        await sendText(env, reminder.chat_id,
          "⏰ JARVIS REMINDER\n\n" + reminder.task + "\n\nScheduled: " + formatManila(reminder.due_at));
        if (reminder.call_status === "pending") {
          const spoken = "JARVIS reminder. " + reminder.task + ". Scheduled for " + formatManila(reminder.due_at) + ".";
          const call = await placePhoneCall(env, reminder.chat_id, spoken, "reminder");
          await env.DB.prepare(
            "UPDATE phone_call_reminders SET status = ?, call_sid = ?, completed_at = ?, last_error = ? WHERE reminder_id = ? AND status = 'pending'"
          ).bind(
            call.ok ? "initiated" : "failed",
            call.callSid || null,
            new Date().toISOString(),
            call.ok ? null : String(call.error || "Call not placed").slice(0, 240),
            reminder.id
          ).run();
          if (!call.ok) {
            await sendText(env, reminder.chat_id, "📞 Reminder phone call was not placed: " + call.error);
          }
        }
        await env.DB.prepare("UPDATE reminders SET sent_at = ? WHERE id = ? AND sent_at IS NULL")
          .bind(new Date().toISOString(), reminder.id).run();
      } catch (error) {
        console.error("Could not deliver reminder", reminder.id, error?.message || "unknown error");
      }
    }
  }
};
