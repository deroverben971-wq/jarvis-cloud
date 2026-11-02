import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarDeleteQuery, classifyCalendarRequest, parseCalendarEventRequest,
  parseCalendarMoveRequest
} from "../src/calendar-intents.mjs";

const now = new Date("2026-11-02T01:00:00.000Z"); // 9:00 AM Manila, Monday

test("routes natural-language calendar lookups", () => {
  assert.deepEqual(classifyCalendarRequest("What's on my calendar tomorrow?"), {kind:"list",range:"tomorrow"});
  assert.deepEqual(classifyCalendarRequest("What meetings do I have this week?"), {kind:"list",range:"week"});
  assert.deepEqual(classifyCalendarRequest("What's my schedule tomorrow?"), {kind:"list",range:"tomorrow"});
});

test("parses event creation with a person, date, time, and duration", () => {
  assert.deepEqual(parseCalendarEventRequest("Schedule a meeting with Alex tomorrow at 3 PM for 30 minutes", now), {
    ok: true, title: "meeting with Alex", start: "2026-11-03T07:00:00.000Z",
    end: "2026-11-03T07:30:00.000Z", durationMinutes: 30
  });
});

test("parses a title-first calendar event and defaults to one hour", () => {
  const result = parseCalendarEventRequest("Add dentist appointment to my calendar on Friday at 10 AM", now);
  assert.equal(result.ok, true);
  assert.match(result.title, /dentist appointment/i);
  assert.equal(result.durationMinutes, 60);
});

test("asks for AM or PM rather than guessing", () => {
  const result = parseCalendarEventRequest("Schedule a meeting tomorrow at 6:00", now);
  assert.equal(result.ok, false);
  assert.equal(result.needsClarification, true);
  assert.match(result.error, /AM or PM/);
});

test("asks for the missing date or time", () => {
  const noDate = parseCalendarEventRequest("Schedule a meeting with Alex at 3 PM", now);
  assert.equal(noDate.ok, false);
  assert.equal(noDate.missing, "date");
  const noTime = parseCalendarEventRequest("Schedule a meeting with Alex tomorrow", now);
  assert.equal(noTime.ok, false);
  assert.equal(noTime.missing, "time");
});

test("supports month-name dates and a 24-hour clock", () => {
  const result = parseCalendarEventRequest("Create event Project review on Nov 5 at 16:30", now);
  assert.equal(result.ok, true);
  assert.equal(result.start, "2026-11-05T08:30:00.000Z");
});

test("parses reschedule targets and event search terms", () => {
  const result = parseCalendarMoveRequest("Move my dentist appointment to tomorrow at 4 PM", now);
  assert.equal(result.ok, true);
  assert.equal(result.query, "dentist appointment");
  assert.equal(result.start, "2026-11-03T08:00:00.000Z");
});

test("parses natural event cancellation without confusing reminder cancellation", () => {
  assert.deepEqual(classifyCalendarRequest("Cancel my dentist appointment"), {kind:"delete"});
  assert.equal(calendarDeleteQuery("Cancel my dentist appointment"), "dentist appointment");
  assert.equal(classifyCalendarRequest("Cancel reminder 3"), null);
});

test("does not classify reminder requests as calendar creates", () => {
  assert.equal(classifyCalendarRequest("Remind me tomorrow at 6 PM to call Alex"), null);
  assert.equal(classifyCalendarRequest("Give me a meeting reminder at 6 PM"), null);
});

test("does not route ordinary cancellation or move requests to Calendar", () => {
  assert.equal(classifyCalendarRequest("Cancel my subscription"), null);
  assert.equal(classifyCalendarRequest("Cancel my meeting reminder"), null);
  assert.equal(classifyCalendarRequest("Move my project files to the archive"), null);
});



test("understands polite calendar requests while keeping reminder cancellation separate", () => {
  assert.deepEqual(classifyCalendarRequest("Can you show my calendar tomorrow?"), {kind:"list",range:"tomorrow"});
  assert.deepEqual(classifyCalendarRequest("Could you schedule a meeting with Alex tomorrow at 3 PM?"), {kind:"create"});
  assert.deepEqual(classifyCalendarRequest("Can you move my dentist appointment to Friday at 4 PM?"), {kind:"move"});
  assert.deepEqual(classifyCalendarRequest("Could you cancel my dentist appointment?"), {kind:"delete"});
  assert.equal(classifyCalendarRequest("Can you cancel my reminder 3?"), null);
});

test("parses a polite meeting request and preserves the event title", () => {
  const result = parseCalendarEventRequest("Can you schedule a meeting with Alex tomorrow at 3 PM?", now);
  assert.equal(result.ok, true);
  assert.equal(result.title, "meeting with Alex");
});
