// Function definitions and pure helpers for JARVIS's tool-using AI agent.
// These schemas are passed to Cloudflare Workers AI's native function-calling API.

export const JARVIS_AGENT_TOOLS = [
  {
    name: "list_reminders",
    description: "Read the user's reminders. Call this before editing or cancelling when the target is described by context such as 'the previous one', 'that reminder', or a task name.",
    parameters: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["active", "all", "cancelled"], description: "Which reminders to show." },
        day: { type: "string", enum: ["any", "today", "tomorrow"], description: "Optional date filter." }
      },
      required: ["scope", "day"]
    }
  },
  {
    name: "create_reminder",
    description: "Create a new one-time or recurring Telegram reminder. Use only when the user actually asks to create a reminder. due_at must be ISO 8601 with timezone offset or Z. Interpret relative dates in Asia/Manila.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "What the user wants to be reminded about." },
        due_at: { type: "string", description: "First due occurrence in ISO 8601 with timezone." },
        recurrence: { type: "string", enum: ["none", "daily", "weekly"], description: "Repeat frequency." },
        recurrence_until: { type: "string", description: "Optional ISO 8601 end date/time, or empty string for no end." }
      },
      required: ["task", "due_at", "recurrence", "recurrence_until"]
    }
  },
  {
    name: "update_reminders",
    description: "Edit existing active reminders. IDs must come from user references or list_reminders results. Never create a new reminder to satisfy an edit. Empty task/due_at means leave unchanged. recurrence='unchanged' preserves current recurrence.",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 10 },
        task: { type: "string", description: "New task text, or empty string to leave unchanged." },
        due_at: { type: "string", description: "New due time in ISO 8601 with timezone, or empty string to leave unchanged." },
        recurrence: { type: "string", enum: ["unchanged", "none", "daily", "weekly"], description: "New repeat frequency, or unchanged." },
        recurrence_until: { type: "string", description: "New ISO 8601 end date, 'clear' to remove end date, or empty string to leave unchanged." }
      },
      required: ["ids", "task", "due_at", "recurrence", "recurrence_until"]
    }
  },
  {
    name: "cancel_reminders",
    description: "Cancel one or more exact active reminder IDs. First list reminders if the IDs or referents are ambiguous. The operation is all-or-nothing: if any ID is invalid, no reminder is cancelled.",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 10 }
      },
      required: ["ids"]
    }
  },
  {
    name: "list_calendar",
    description: "Read the user's Google Calendar events for a date range.",
    parameters: {
      type: "object",
      properties: { range: { type: "string", enum: ["today", "tomorrow", "week", "next_week"] } },
      required: ["range"]
    }
  },
  {
    name: "create_calendar_event",
    description: "Prepare a Google Calendar event. The system will show an exact preview and require user confirmation before writing to Calendar.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD in Asia/Manila." },
        time: { type: "string", description: "24-hour HH:MM in Asia/Manila." },
        duration_minutes: { type: "integer", minimum: 5, maximum: 720 }
      },
      required: ["title", "date", "time", "duration_minutes"]
    }
  },
  {
    name: "move_calendar_event",
    description: "Prepare moving a matching Calendar event. The system checks event identity and requires confirmation before changing it.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" }, date: { type: "string" }, time: { type: "string" }
      },
      required: ["query", "date", "time"]
    }
  },
  {
    name: "delete_calendar_event",
    description: "Find a Calendar event to delete. The system will show the exact event and ask for confirmation before deletion.",
    parameters: {
      type: "object", properties: { query: { type: "string" } }, required: ["query"]
    }
  },
  {
    name: "save_memory",
    description: "Save a fact or preference only when the user explicitly asks JARVIS to remember it.",
    parameters: {
      type: "object", properties: { fact: { type: "string" } }, required: ["fact"]
    }
  },
  {
    name: "list_memories",
    description: "List facts and preferences the user has explicitly saved.",
    parameters: { type: "object", properties: {}, required: [] }
  }
];

// Native Ollama / OpenAI-compatible function schema. Both the local Ollama brain
// and the Cloudflare fallback use the same capabilities and argument contracts.
export const JARVIS_OLLAMA_TOOLS = JARVIS_AGENT_TOOLS.map(tool => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }
}));

export function parseToolArguments(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") throw new Error("Tool arguments were not an object.");
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments were not a JSON object.");
  }
  return parsed;
}

export function normalizeReminderIds(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    throw new Error("Choose between 1 and 10 reminder IDs.");
  }
  const ids = [];
  for (const raw of value) {
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || id < 1) throw new Error("A reminder ID was invalid.");
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function validateIsoDateTime(value, now = new Date()) {
  if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) {
    throw new Error("The date/time must include a timezone, such as +08:00 or Z.");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= now.getTime()) {
    throw new Error("That date/time is invalid or is not in the future.");
  }
  return date.toISOString();
}

export function nextRecurringDueAt(value, recurrence) {
  if (recurrence !== "daily" && recurrence !== "weekly") {
    throw new Error("Only daily and weekly recurrence are supported.");
  }
  const due = new Date(value);
  if (!Number.isFinite(due.getTime())) throw new Error("The current due date is invalid.");
  // Asia/Manila has a fixed UTC+8 offset; advancing by whole UTC days preserves
  // the same Manila wall-clock time for daily/weekly reminders.
  const days = recurrence === "daily" ? 1 : 7;
  return new Date(due.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function extractToolCalls(result) {
  const candidates = [
    result?.tool_calls,
    result?.message?.tool_calls,
    result?.response?.tool_calls,
    result?.response?.message?.tool_calls,
    result?.choices?.[0]?.message?.tool_calls
  ];
  for (const value of candidates) {
    if (Array.isArray(value) && value.length) {
      return value.map(call => {
        const fn = call?.function || call;
        return {
          name: String(fn?.name || call?.name || ""),
          arguments: fn?.arguments ?? call?.arguments ?? {}
        };
      }).filter(call => call.name);
    }
  }
  return [];
}
