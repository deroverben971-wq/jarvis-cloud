const MANILA_TZ = "Asia/Manila";
const WEEKDAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6
};

function getReminderLead(value) {
  const text = String(value || "").trim();
  const leads = [
    /^\/(?:reminder|remind)(?:\s+me)?(?:\s+|$)/i,
    /^remind\s+me(?:\s+|$)/i,
    /^(?:please\s+)?(?:set|create|make|add|schedule)\s+(?:me\s+)?(?:an?\s+)?(?:(meeting|appointment|call)\s+)?reminder\b(?:\s+|$)/i,
    /^(?:please\s+)?give\s+me\s+(?:an?\s+)?(?:(meeting|appointment|call)\s+)?reminder\b(?:\s+|$)/i,
    /^(?:please\s+)?(?:i need|i want)\s+(?:an?\s+)?(?:(meeting|appointment|call)\s+)?reminder\b(?:\s+|$)/i,
    /^reminder(?:\s+|$)/i
  ];
  for (const pattern of leads) {
    const match = pattern.exec(text);
    if (match) {
      return { rest: text.slice(match[0].length).trim(), taskHint: match[1] ? match[1].toLowerCase() : "" };
    }
  }
  return null;
}

export function isReminderRequest(value) {
  return getReminderLead(value) !== null;
}

function localDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MANILA_TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const result = {};
  for (const part of parts) if (part.type !== "literal") result[part.type] = part.value;
  return { year: Number(result.year), month: Number(result.month), day: Number(result.day) };
}

function validDateParts(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

export function manilaInputToUtc(dateText, timeText) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ""));
  const t = /^(\d{2}):(\d{2})$/.exec(String(timeText || ""));
  if (!d || !t) return null;
  const year = Number(d[1]), month = Number(d[2]), day = Number(d[3]);
  const hour = Number(t[1]), minute = Number(t[2]);
  if (!validDateParts(year, month, day) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  // Validate the Manila calendar date before applying UTC+8. Local midnight through 07:59
  // belongs to the previous UTC date, so comparing the converted UTC date to the input date
  // would incorrectly reject valid early-morning reminders.
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute));
}

function addCalendarDays(dateParts, delta) {
  const date = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day + delta));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function formatDateParts(parts) {
  return String(parts.year).padStart(4, "0") + "-" +
    String(parts.month).padStart(2, "0") + "-" +
    String(parts.day).padStart(2, "0");
}

function stripSpans(text, spans) {
  let output = text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, span.start) + " " + output.slice(span.end);
  }
  return output
    .replace(/^\s*(?:(?:at|on|to|for|about|please)\b[\s,:;-]*)+/i, "")
    .replace(/\s+(?:at|on|to|for|about|please)$/i, "")
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function taskFromText(text, spans) {
  const task = stripSpans(text, spans);
  if (!task) return { ok: false, error: "Please include what you want me to remind you about." };
  if (task.length > 300) return { ok: false, error: "Keep the reminder task under 300 characters." };
  return { ok: true, task };
}

function resultForDue(due, task, now) {
  if (!due || Number.isNaN(due.getTime())) {
    return { ok: false, error: "I couldn't read that date or time." };
  }
  if (due.getTime() <= now.getTime()) {
    return { ok: false, error: "That time has already passed. Please give me a future time in Manila time." };
  }
  return { ok: true, dueAt: due.toISOString(), task };
}

/**
 * Parses explicit and natural-language reminder requests in Asia/Manila time.
 * Returns {ok:true,dueAt,task} or {ok:false,error}. Non-reminder messages are
 * not accepted here; callers should check isReminderRequest first.
 */
export function parseReminderRequest(raw, now = new Date()) {
  const original = String(raw || "").trim();
  const lead = getReminderLead(original);
  if (!lead) {
    return { ok: false, error: "Start with a reminder request such as 'remind me tomorrow at 8 AM'." };
  }
  const rest = lead.rest;
  if (!rest) return { ok: false, error: "Tell me the date, time, and task." };

  // Keep the established exact format working.
  const explicit = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s+([\s\S]{1,300})$/.exec(rest);
  if (explicit) {
    const time = explicit[2].padStart(5, "0");
    const due = manilaInputToUtc(explicit[1], time);
    if (!due) return { ok: false, error: "The date or 24-hour time is invalid." };
    let taskResult = taskFromText(explicit[3], []);
    if (!taskResult.ok && lead.taskHint) taskResult = { ok: true, task: lead.taskHint };
    if (!taskResult.ok) return taskResult;
    return resultForDue(due, taskResult.task, now);
  }

  // Relative offsets, e.g. "remind me in 15 minutes to take a break".
  const relative = /\bin\s+(\d{1,3})\s+(minutes?|hours?)\b/i.exec(rest);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase().startsWith("hour") ? 60 : 1;
    if (!Number.isInteger(amount) || amount < 1 || amount * unit > 10080) {
      return { ok: false, error: "Choose a reminder between 1 minute and 7 days from now." };
    }
    let taskResult = taskFromText(rest, [{ start: relative.index, end: relative.index + relative[0].length }]);
    if (!taskResult.ok && lead.taskHint) taskResult = { ok: true, task: lead.taskHint };
    if (!taskResult.ok) return taskResult;
    return resultForDue(new Date(now.getTime() + amount * unit * 60000), taskResult.task, now);
  }

  let dateMatch = /\b(tomorrow|today|next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2})\b/i.exec(rest);
  let timeMatch = /\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(rest);
  let hour, minute;
  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2] || "0");
    const meridiem = timeMatch[3].toLowerCase().replace(/\./g, "");
    if (hour < 1 || hour > 12) return { ok: false, error: "For AM/PM times, use an hour from 1 to 12." };
    hour = hour % 12 + (meridiem === "pm" ? 12 : 0);
  } else {
    timeMatch = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(rest);
    if (!timeMatch) {
      const bareHour = /\bat\s+(0?[1-9]|1[0-2])\b/i.exec(rest);
      if (bareHour) {
        return {
          ok: false,
          needsClarification: true,
          error: "Do you mean " + bareHour[1] + ":00 AM or " + bareHour[1] + ":00 PM? Please resend the reminder with AM or PM."
        };
      }
      return { ok: false, error: "I need a time such as 8:00 AM or 20:00." };
    }
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    if (hour >= 1 && hour <= 12 && !/^0\d$/.test(timeMatch[1])) {
      return {
        ok: false,
        needsClarification: true,
        error: "Do you mean " + timeMatch[0] + " AM or PM? Please resend the reminder with AM or PM."
      };
    }
  }

  const nowParts = localDateParts(now);
  let target = { ...nowParts };
  let dateKind = "implicit";
  const spans = [{ start: timeMatch.index, end: timeMatch.index + timeMatch[0].length }];

  if (dateMatch) {
    spans.push({ start: dateMatch.index, end: dateMatch.index + dateMatch[0].length });
    const phrase = dateMatch[0].toLowerCase().replace(/\s+/g, " ");
    if (phrase === "tomorrow") {
      target = addCalendarDays(nowParts, 1);
      dateKind = "tomorrow";
    } else if (phrase === "today") {
      dateKind = "today";
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(phrase)) {
      const [year, month, day] = phrase.split("-").map(Number);
      if (!validDateParts(year, month, day)) return { ok: false, error: "That calendar date does not exist." };
      target = { year, month, day };
      dateKind = "explicit";
    } else {
      const weekdayText = phrase.replace(/^next\s+/, "");
      const requestedDay = WEEKDAYS[weekdayText];
      const currentDay = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)).getUTCDay();
      let delta = (requestedDay - currentDay + 7) % 7;
      if (phrase.startsWith("next ") && delta === 0) delta = 7;
      target = addCalendarDays(nowParts, delta);
      dateKind = phrase.startsWith("next ") ? "next-weekday" : "weekday";
    }
  }

  const timeText = String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
  let due = manilaInputToUtc(formatDateParts(target), timeText);
  if (!due) return { ok: false, error: "I couldn't read that date or time." };

  // A time-only request means the next occurrence. An unqualified weekday that is
  // today and already passed means that weekday next week, never a silent past due time.
  if (due.getTime() <= now.getTime() && dateKind === "implicit") {
    target = addCalendarDays(target, 1);
    due = manilaInputToUtc(formatDateParts(target), timeText);
  } else if (due.getTime() <= now.getTime() && dateKind === "weekday") {
    target = addCalendarDays(target, 7);
    due = manilaInputToUtc(formatDateParts(target), timeText);
  }

  let taskResult = taskFromText(rest, spans);
  if (!taskResult.ok && lead.taskHint) taskResult = { ok: true, task: lead.taskHint };
  if (!taskResult.ok) return taskResult;
  return resultForDue(due, taskResult.task, now);
}
