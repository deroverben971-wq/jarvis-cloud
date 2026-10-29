import test from "node:test";
import assert from "node:assert/strict";
import { isReminderRequest, manilaInputToUtc, parseReminderRequest } from "../src/reminder-parser.mjs";

const now = new Date("2026-10-29T14:56:00.000Z"); // 10:56 PM in Manila

test("routes /reminder tomorrow 8:00 am as a saved reminder request", () => {
  assert.equal(isReminderRequest("/reminder tomorrow 8:00 am continue building JARVIS"), true);
  assert.deepEqual(parseReminderRequest("/reminder tomorrow 8:00 am continue building JARVIS", now), {
    ok: true,
    dueAt: "2026-10-30T00:00:00.000Z",
    task: "continue building JARVIS"
  });
});

test("supports natural language with 'remind me' and connector words", () => {
  const result = parseReminderRequest("remind me tomorrow at 8 AM to continue building JARVIS.", now);
  assert.equal(result.ok, true);
  assert.equal(result.dueAt, "2026-10-30T00:00:00.000Z");
  assert.equal(result.task, "continue building JARVIS");
});

test("keeps the existing explicit /remind date and 24-hour time format", () => {
  const result = parseReminderRequest("/remind 2026-10-30 08:00 Continue building JARVIS", now);
  assert.deepEqual(result, {
    ok: true,
    dueAt: "2026-10-30T00:00:00.000Z",
    task: "Continue building JARVIS"
  });
});

test("supports 24-hour time in natural-language requests", () => {
  const result = parseReminderRequest("/reminder tomorrow at 20:15 finish homework", now);
  assert.equal(result.ok, true);
  assert.equal(result.dueAt, "2026-10-30T12:15:00.000Z");
  assert.equal(result.task, "finish homework");
});

test("supports relative minute and hour reminders", () => {
  const result = parseReminderRequest("remind me in 15 minutes to take a break", now);
  assert.equal(result.ok, true);
  assert.equal(result.dueAt, "2026-10-29T15:11:00.000Z");
  assert.equal(result.task, "take a break");
});

test("handles midnight and early-morning Manila times correctly", () => {
  assert.equal(manilaInputToUtc("2026-10-30", "00:00").toISOString(), "2026-10-29T16:00:00.000Z");
  assert.equal(manilaInputToUtc("2026-10-30", "07:59").toISOString(), "2026-10-29T23:59:00.000Z");
});

test("rejects missing time and missing task rather than passing it to general AI", () => {
  assert.equal(parseReminderRequest("/reminder tomorrow continue building JARVIS", now).ok, false);
  assert.equal(parseReminderRequest("/reminder tomorrow 8:00 am", now).ok, false);
});

test("rejects nonexistent dates and past explicit times", () => {
  assert.equal(parseReminderRequest("/remind 2026-02-30 18:00 task", now).ok, false);
  assert.equal(parseReminderRequest("/remind 2026-10-28 18:00 task", now).ok, false);
});

test("does not classify ordinary messages or optional phone-call commands as reminders", () => {
  assert.equal(isReminderRequest("hello JARVIS"), false);
  assert.equal(isReminderRequest("/remindcall 2026-10-30 08:00 call me"), false);
});
