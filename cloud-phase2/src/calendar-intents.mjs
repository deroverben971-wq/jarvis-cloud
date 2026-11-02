const TZ = "Asia/Manila";
const WEEKDAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6
};
const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12
};

function manilaParts(date) {
  const values = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return { year: values.year, month: values.month, day: values.day };
}

function addDays(parts, amount) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + amount));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function validDate(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const check = new Date(Date.UTC(y, m - 1, d));
  return check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d;
}

function dateToUtc(parts, hour, minute) {
  if (!validDate(parts.year, parts.month, parts.day)) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 ||
      !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 8, minute));
}

function removeSpans(value, spans) {
  let output = value;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, span.start) + " " + output.slice(span.end);
  }
  return output.replace(/[?!.]+\s*$/g, "")
    .replace(/\b(?:to|on|at|for|in|my)\s*$/i, "")
    .replace(/^\s*(?:on|at|to|for|please)\b[\s,:;-]*/i, "")
    .replace(/\s+(?:on|at|to|for|in)\s*$/i, "")
    .replace(/\b(?:in|on)\s+my\s+calendar\b/ig, "")
    .replace(/\bto\s+my\s+calendar\b/ig, "")
    .replace(/^[\s,;:?.! -]+|[\s,;:?.! -]+$/g, "")
    .replace(/\s+/g, " ").trim();
}

function parseDatePhrase(value, now) {
  const patterns = [
    /\bday after tomorrow\b/i,
    /\btomorrow\b/i,
    /\btoday\b/i,
    /\bnext\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    /\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/i
  ];
  let match = null;
  for (const pattern of patterns) {
    match = pattern.exec(value);
    if (match) break;
  }
  if (!match) return { ok: false, missing: "date" };

  const phrase = match[0].toLowerCase().replace(/\s+/g, " ").trim();
  const today = manilaParts(now);
  let target = { ...today };
  if (phrase === "tomorrow") target = addDays(today, 1);
  else if (phrase === "day after tomorrow") target = addDays(today, 2);
  else if (phrase === "today") target = { ...today };
  else if (/^\d{4}-\d{2}-\d{2}$/.test(phrase)) {
    const [year, month, day] = phrase.split("-").map(Number);
    if (!validDate(year, month, day)) return { ok: false, error: "That calendar date is invalid." };
    target = { year, month, day };
  } else if (Object.prototype.hasOwnProperty.call(WEEKDAYS, phrase.replace(/^next\s+/, ""))) {
    const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
    let delta = (WEEKDAYS[phrase.replace(/^next\s+/, "")] - weekday + 7) % 7;
    if (phrase.startsWith("next ") || delta === 0) delta = delta || 7;
    target = addDays(today, delta);
  } else if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)/i.test(phrase)) {
    const m = /([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i.exec(phrase);
    if (!m) return { ok: false, error: "I couldn't read that date." };
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    let year = m[3] ? Number(m[3]) : today.year;
    if (!m[3] && month < today.month || (!m[3] && month === today.month && day < today.day)) year += 1;
    if (!validDate(year, month, day)) return { ok: false, error: "That calendar date is invalid." };
    target = { year, month, day };
  }
  return { ok: true, target, span: { start: match.index, end: match.index + match[0].length } };
}

function parseTimePhrase(value) {
  let match = /\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(value);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2] || "0");
    if (hour < 1 || hour > 12) return { ok: false, error: "For AM/PM, use an hour from 1 to 12." };
    const pm = match[3].toLowerCase().replace(/\./g, "") === "pm";
    hour = hour % 12 + (pm ? 12 : 0);
    return { ok: true, hour, minute, span: { start: match.index, end: match.index + match[0].length } };
  }

  match = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(value);
  if (match) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour >= 1 && hour <= 12 && !/^0\d$/.test(match[1])) {
      const hint = /\b(?:tonight|evening|afternoon)\b/i.test(value) ? "PM"
        : /\b(?:morning)\b/i.test(value) ? "AM" : "";
      if (!hint) return {
        ok: false, needsClarification: true,
        error: "Do you mean " + match[0] + " AM or PM? Please include AM or PM."
      };
      const adjusted = hour % 12 + (hint === "PM" ? 12 : 0);
      return { ok: true, hour: adjusted, minute, span: { start: match.index, end: match.index + match[0].length } };
    }
    return { ok: true, hour, minute, span: { start: match.index, end: match.index + match[0].length } };
  }

  match = /\bat\s+(0?[1-9]|1[0-2])\b/i.exec(value);
  if (match) {
    const hint = /\b(?:tonight|evening|afternoon)\b/i.test(value) ? "PM"
      : /\b(?:morning)\b/i.test(value) ? "AM" : "";
    if (!hint) return {
      ok: false, needsClarification: true,
      error: "Do you mean " + match[1] + ":00 AM or " + match[1] + ":00 PM? Please include AM or PM."
    };
    const baseHour = Number(match[1]);
    return {
      ok: true, hour: baseHour % 12 + (hint === "PM" ? 12 : 0), minute: 0,
      span: { start: match.index + match[0].lastIndexOf(match[1]), end: match.index + match[0].length }
    };
  }
  return { ok: false, missing: "time" };
}

function parseDateTime(value, now) {
  const date = parseDatePhrase(value, now);
  if (!date.ok) return date;
  const time = parseTimePhrase(value);
  if (!time.ok) return time;
  const start = dateToUtc(date.target, time.hour, time.minute);
  if (!start) return { ok: false, error: "I couldn't convert that date and time." };
  if (start.getTime() <= now.getTime()) return { ok: false, error: "That event time has already passed. Please choose a future Manila date and time." };
  return {
    ok: true, start: start.toISOString(),
    spans: [date.span, time.span], target: date.target, hour: time.hour, minute: time.minute
  };
}

function normalizeCalendarRequest(value) {
  let text = String(value || "").trim();
  text = text.replace(/^(?:hey|hi|hello)\s+(?:there\s+)?jarvis\b[\s,!:.-]*/i, "");
  text = text.replace(/^jarvis\b[\s,!:.-]*/i, "");
  text = text.replace(/^(?:please\s+)?(?:can|could|would)\s+you(?:\s+please)?\s+/i, "");
  return text.trim();
}

export function classifyCalendarRequest(raw) {
  const value = normalizeCalendarRequest(raw);
  const text = value.toLowerCase();
  if (!text || /^\/(?:calendar|event|alarm|deleteevent|confirmdelete|canceldelete)\b/i.test(text)) return null;

  if (/^(?:(?:please)\s+|(?:(?:can|could|would)\s+you(?:\s+please)?\s+))?(?:move|reschedule|change)\s+(?:my\s+)?(.+?)\s+(?:to|for)\s+(.+)$/i.test(value) &&
      /\b(?:calendar|event|meeting|appointment|agenda|call)\b/i.test(value)) {
    return { kind: "move" };
  }
  const deleteTarget = value.replace(/^(?:(?:please)\s+|(?:(?:can|could|would)\s+you(?:\s+please)?\s+))?(?:cancel|delete|remove)\s+(?:my\s+)?/i, "");
  if (/^(?:(?:please)\s+|(?:(?:can|could|would)\s+you(?:\s+please)?\s+))?(?:cancel|delete|remove)\s+(?:my\s+)?(?:calendar\s+)?(.+)$/i.test(value) &&
      /\b(?:calendar|event|meeting|appointment|agenda|call)\b/i.test(deleteTarget) &&
      !/\b(?:reminders?|alarms?)\b/i.test(deleteTarget)) {
    return { kind: "delete" };
  }
  if (/^(?:show|list|open|check)(?:\s+me)?\s+(?:my\s+)?(?:google\s+)?calendar(?:\s+events)?(?:\s+(?:today|tomorrow|this week|next week))?\??$/i.test(value) ||
      /^(?:can|could|would)\s+you\s+(?:please\s+)?(?:show|list|open|check)\s+(?:me\s+)?(?:my\s+)?(?:google\s+)?calendar(?:\s+events)?(?:\s+(?:today|tomorrow|this week|next week))?\??$/i.test(value) ||
      /^(?:what'?s|what is|what are|do i have|show me)\b.*\b(?:calendar|calendar events|events|agenda)\b/i.test(value) ||
      /^(?:what'?s|what is)\s+(?:on\s+)?(?:my\s+)?schedule\s+(?:today|tomorrow|this week|next week)\??$/i.test(value) ||
      /^(?:list|show)\s+(?:my\s+)?(?:meetings|appointments)\s+(?:today|tomorrow|this week|next week)\??$/i.test(value) ||
      /^(?:(?:what(?:\s+are)?|what'?s|what is|what are|do i have|show me)\s+)?(?:any\s+)?(?:my\s+)?(?:meetings|appointments)\b.*\b(?:today|tomorrow|this week|next week)\??$/i.test(value)) {
    return { kind: "list", range: /\bnext week\b/i.test(text) ? "next_week"
      : /\bthis week\b/i.test(text) ? "week"
      : /\btomorrow\b/i.test(text) ? "tomorrow"
      : /\btoday\b/i.test(text) ? "today" : "week" };
  }
  if (/^(?:(?:please)\s+|(?:(?:can|could|would)\s+you(?:\s+please)?\s+))?(?:i need to\s+|i want to\s+|i'd like to\s+)?(?:schedule|book|add|create|put|set up|arrange)\b/i.test(value) &&
      /\b(?:calendar|event|meeting|appointment)\b|\bto my calendar\b|\bon my calendar\b/i.test(value)) {
    return { kind: "create" };
  }
  if (/^(?:please\s+)?(?:set|make|create)\s+(?:me\s+)?(?:a|an)\s+(?:meeting|appointment|event)\b/i.test(value)) {
    return { kind: "create" };
  }
  return null;
}

export function parseCalendarEventRequest(raw, now = new Date()) {
  const original = normalizeCalendarRequest(raw);
  let body = original.replace(/^(?:(?:please)\s+|(?:(?:can|could|would)\s+you(?:\s+please)?\s+))?(?:i need to\s+|i want to\s+|i'd like to\s+)?(?:schedule|book|add|create|put|set up|arrange)\s+/i, "");
  body = body.replace(/^set\s+(?:me\s+)?(?:a|an)\s+/i, "");
  body = body.replace(/^(?:a|an|the)\s+/i, "");
  const parsed = parseDateTime(body, now);
  if (!parsed.ok) return parsed;

  const durationMatch = /\bfor\s+(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b/i.exec(body);
  let durationMinutes = 60;
  let durationSpan = null;
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = /^h/i.test(durationMatch[2]) ? 60 : 1;
    durationMinutes = amount * unit;
    durationSpan = { start: durationMatch.index, end: durationMatch.index + durationMatch[0].length };
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 720) {
      return { ok: false, error: "Choose an event duration from 5 minutes to 12 hours." };
    }
  }

  const spans = [...parsed.spans];
  if (durationSpan) spans.push(durationSpan);
  let title = removeSpans(body, spans)
    .replace(/\b(?:to|in|on)\s+my\s+calendar\b/ig, "")
    .replace(/^(?:calendar\s+)?event\s*[:,-]?\s*/i, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .trim();
  if (!title) {
    const type = /\b(appointment|meeting|event)\b/i.exec(body);
    title = type ? type[1][0].toUpperCase() + type[1].slice(1).toLowerCase() : "Calendar event";
  }
  if (title.length > 160) return { ok: false, error: "Keep the event title under 160 characters." };
  const start = new Date(parsed.start);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  return { ok: true, title, start: start.toISOString(), end: end.toISOString(), durationMinutes };
}

export function parseCalendarMoveRequest(raw, now = new Date()) {
  const match = /^(?:please\s+)?(?:move|reschedule|change)\s+(?:my\s+)?(.+?)\s+(?:to|for)\s+(.+)$/i.exec(normalizeCalendarRequest(raw));
  if (!match) return { ok: false, error: "Say which event to move and the new date and time." };
  const query = match[1].replace(/^(?:calendar\s+)?(?:event|meeting|appointment)\s+/i, "").trim();
  if (query.length < 2) return { ok: false, error: "Please include the event title so I can find the right calendar entry." };
  const target = parseDateTime(match[2], now);
  if (!target.ok) return target;
  return { ok: true, query: query.slice(0, 100), start: target.start };
}

export function calendarDeleteQuery(raw) {
  let query = normalizeCalendarRequest(raw)
    .replace(/^(?:please\s+)?(?:cancel|delete|remove)\s+(?:my\s+)?/i, "")
    .replace(/^(?:calendar\s+)?(?:event|meeting|appointment)\s+/i, "")
    .replace(/\s+from\s+(?:my\s+)?calendar$/i, "")
    .trim();
  return query.slice(0, 100);
}

export function calendarRangeLabel(value) {
  const text = String(value || "").toLowerCase();
  if (/\bnext week\b/.test(text)) return "next_week";
  if (/\bthis week\b/.test(text)) return "week";
  if (/\btomorrow\b/.test(text)) return "tomorrow";
  if (/\btoday\b/.test(text)) return "today";
  return "week";
}
