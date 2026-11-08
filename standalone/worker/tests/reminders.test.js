import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReminderInput, processDueReminders } from "../src/services/reminders.js";

const NOW = Date.parse("2026-11-08T01:00:00.000Z");

test("reminder input requires a title and an explicit timezone", () => {
  assert.throws(
    () => normalizeReminderInput({ title: "", runAt: "2026-11-08T02:00:00Z" }, NOW),
    { code: "REMINDER_TITLE_INVALID" }
  );
  assert.throws(
    () => normalizeReminderInput({ title: "Call", runAt: "2026-11-08T02:00:00" }, NOW),
    { code: "REMINDER_TIME_INVALID" }
  );
});

test("reminder input normalizes a valid timezone-aware future time to UTC", () => {
  const result = normalizeReminderInput({
    title: "Call",
    body: "Review the project notes",
    runAt: "2026-11-08T10:00:00+08:00"
  }, NOW);

  assert.equal(result.title, "Call");
  assert.equal(result.body, "Review the project notes");
  assert.equal(result.runAt, "2026-11-08T02:00:00.000Z");
});

test("reminder input rejects past, too-soon, and over-one-year schedules", () => {
  assert.throws(
    () => normalizeReminderInput({ title: "Past", runAt: "2026-11-08T00:00:00Z" }, NOW),
    { code: "REMINDER_MUST_BE_IN_FUTURE" }
  );
  assert.throws(
    () => normalizeReminderInput({ title: "Soon", runAt: "2026-11-08T01:00:10Z" }, NOW),
    { code: "REMINDER_MUST_BE_IN_FUTURE" }
  );
  assert.throws(
    () => normalizeReminderInput({ title: "Far", runAt: "2028-01-01T00:00:00Z" }, NOW),
    { code: "REMINDER_TOO_FAR_AHEAD" }
  );
});

test("reminder titles and notes have bounded lengths", () => {
  assert.throws(
    () => normalizeReminderInput({ title: "x".repeat(121), runAt: "2026-11-08T02:00:00Z" }, NOW),
    { code: "REMINDER_TITLE_INVALID" }
  );
  assert.throws(
    () => normalizeReminderInput({ title: "Call", body: "x".repeat(501), runAt: "2026-11-08T02:00:00Z" }, NOW),
    { code: "REMINDER_BODY_TOO_LONG" }
  );
});

test("due reminders produce one idempotent inbox notification batch", async () => {
  const dueJob = {
    id: "job-1",
    user_id: "user-1",
    job_type: "reminder",
    payload_json: JSON.stringify({ title: "Take a break", body: "Stretch for a moment" }),
    run_at: "2026-11-08T01:00:00.000Z"
  };
  const prepared = [];
  const batches = [];
  const db = {
    prepare(sql) {
      prepared.push(sql);
      return {
        bind() {
          return {
            run: async () => ({ meta: { changes: 1 } }),
            all: async () => ({ results: sql.includes("RETURNING id, user_id") ? [dueJob] : [] })
          };
        }
      };
    },
    async batch(statements) {
      batches.push(statements);
      return [];
    }
  };

  const processed = await processDueReminders({ DB: db }, new Date(NOW));
  assert.equal(processed, 1);
  assert.equal(batches.length, 1);
  assert.ok(batches[0][0].sql.includes("ON CONFLICT(scheduled_job_id) DO NOTHING"));
  assert.ok(batches[0][1].sql.includes("status = 'completed'"));
  assert.ok(prepared.some(sql => sql.includes("status = 'running'")));
});

test("missing D1 binding safely skips scheduled processing", async () => {
  assert.equal(await processDueReminders({}, new Date(NOW)), 0);
});
