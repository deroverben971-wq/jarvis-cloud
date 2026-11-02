import test from "node:test";
import assert from "node:assert/strict";
import {
  extractToolCalls,
  JARVIS_OLLAMA_TOOLS,
  nextRecurringDueAt,
  normalizeReminderIds,
  parseToolArguments,
  validateIsoDateTime
} from "../src/agent-tools.mjs";

test("normalizes Cloudflare native function tool calls", () => {
  const calls = extractToolCalls({
    tool_calls: [
      { name: "cancel_reminders", arguments: { ids: [7, 8, 9] } }
    ]
  });
  assert.deepEqual(calls, [{ name: "cancel_reminders", arguments: { ids: [7, 8, 9] } }]);
});

test("normalizes OpenAI-compatible tool call envelopes", () => {
  const calls = extractToolCalls({
    choices: [{ message: { tool_calls: [
      { function: { name: "update_reminders", arguments: "{\"ids\":[8],\"task\":\"Workout\"}" } }
    ] } }]
  });
  assert.equal(calls[0].name, "update_reminders");
  assert.deepEqual(parseToolArguments(calls[0].arguments), { ids: [8], task: "Workout" });
});

test("parses tool arguments only as JSON objects", () => {
  assert.deepEqual(parseToolArguments({ ids: [1] }), { ids: [1] });
  assert.throws(() => parseToolArguments("[]"), /JSON object/);
  assert.throws(() => parseToolArguments("not json"), SyntaxError);
});

test("validates and deduplicates reminder IDs", () => {
  assert.deepEqual(normalizeReminderIds([7, "8", 7, 9]), [7, 8, 9]);
  assert.throws(() => normalizeReminderIds([]), /between 1 and 10/);
  assert.throws(() => normalizeReminderIds([1, 0]), /invalid/);
  assert.throws(() => normalizeReminderIds([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), /between 1 and 10/);
});

test("requires timezone and a future due time", () => {
  const now = new Date("2026-11-02T12:00:00.000Z");
  assert.equal(validateIsoDateTime("2026-11-03T17:00:00+08:00", now), "2026-11-03T09:00:00.000Z");
  assert.throws(() => validateIsoDateTime("2026-11-03T17:00:00", now), /timezone/);
  assert.throws(() => validateIsoDateTime("2026-11-02T11:00:00Z", now), /future/);
});

test("advances recurring reminders without changing Manila wall-clock time", () => {
  assert.equal(
    nextRecurringDueAt("2026-11-02T09:00:00.000Z", "daily"),
    "2026-11-03T09:00:00.000Z"
  );
  assert.equal(
    nextRecurringDueAt("2026-11-02T09:00:00.000Z", "weekly"),
    "2026-11-09T09:00:00.000Z"
  );
  assert.throws(() => nextRecurringDueAt("not a date", "daily"), /invalid/);
});

test("exports standard native function schemas for Ollama", () => {
  assert.ok(JARVIS_OLLAMA_TOOLS.length >= 8);
  const cancel = JARVIS_OLLAMA_TOOLS.find(tool => tool.function.name === "cancel_reminders");
  assert.equal(cancel.type, "function");
  assert.deepEqual(cancel.function.parameters.required, ["ids"]);
});

test("extracts tool calls from Ollama message responses", () => {
  const calls = extractToolCalls({
    message: {
      role: "assistant",
      tool_calls: [{
        function: { name: "list_reminders", arguments: { scope: "active", day: "any" } }
      }]
    }
  });
  assert.deepEqual(calls, [{
    name: "list_reminders",
    arguments: { scope: "active", day: "any" }
  }]);
});
