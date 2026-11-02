import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../google-calendar-apps-script.js", import.meta.url), "utf8");

function createBridge(options = {}) {
  const event = options.event || {
    id: "event-1",
    summary: "Dentist appointment",
    start: { dateTime: "2026-11-04T02:00:00.000Z" },
    end: { dateTime: "2026-11-04T03:00:00.000Z" }
  };
  const calls = { list: null, patch: null, remove: null };
  const properties = new Map([["JARVIS_SHARED_SECRET", "test-secret"]]);
  const context = {
    console,
    Date,
    JSON,
    String,
    Number,
    Math,
    isNaN,
    PropertiesService: {
      getScriptProperties() {
        return { getProperty: (key) => properties.get(key) || null };
      }
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(value) {
        return { value: String(value), setMimeType() { return this; }, getContent() { return this.value; } };
      }
    },
    Calendar: {
      Events: {
        list(calendarId, args) {
          calls.list = { calendarId, args };
          return { items: [event] };
        },
        get() { return event; },
        patch(resource, calendarId, eventId) {
          calls.patch = { resource, calendarId, eventId };
          return {
            id: eventId,
            summary: resource.summary || event.summary,
            start: resource.start,
            end: resource.end
          };
        },
        remove(calendarId, eventId) {
          calls.remove = { calendarId, eventId };
        }
      }
    }
  };
  vm.runInNewContext(source, context, { filename: "google-calendar-apps-script.js" });
  return {
    calls,
    post(body) {
      const output = context.doPost({ postData: { contents: JSON.stringify({ secret: "test-secret", ...body }) } });
      return JSON.parse(output.getContent());
    }
  };
}

test("calendar list accepts an exact date range from the Worker", () => {
  const bridge = createBridge();
  const result = bridge.post({
    action: "list_events",
    timeMin: "2026-11-04T00:00:00.000Z",
    timeMax: "2026-11-05T00:00:00.000Z"
  });
  assert.equal(result.ok, true);
  assert.equal(bridge.calls.list.args.timeMin, "2026-11-04T00:00:00.000Z");
  assert.equal(bridge.calls.list.args.timeMax, "2026-11-05T00:00:00.000Z");
});

test("calendar list rejects invalid or reversed date ranges", () => {
  const bridge = createBridge();
  const result = bridge.post({
    action: "list_events",
    timeMin: "not-a-date",
    timeMax: "2026-11-05T00:00:00.000Z"
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /time range/i);
  assert.equal(bridge.calls.list, null);
});

test("event move checks the original title and start before patching", () => {
  const bridge = createBridge();
  const result = bridge.post({
    action: "update_event",
    eventId: "event-1",
    expectedTitle: "Wrong title",
    expectedStart: "2026-11-04T02:00:00.000Z",
    start: "2026-11-06T08:00:00.000Z",
    end: "2026-11-06T09:00:00.000Z"
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /changed/i);
  assert.equal(bridge.calls.patch, null);
});

test("event move updates only after exact original-event verification", () => {
  const bridge = createBridge();
  const result = bridge.post({
    action: "update_event",
    eventId: "event-1",
    expectedTitle: "Dentist appointment",
    expectedStart: "2026-11-04T02:00:00.000Z",
    start: "2026-11-06T08:00:00.000Z",
    end: "2026-11-06T09:00:00.000Z"
  });
  assert.equal(result.ok, true);
  assert.equal(result.event.title, "Dentist appointment");
  assert.equal(bridge.calls.patch.eventId, "event-1");
  assert.equal(bridge.calls.patch.resource.start.dateTime, "2026-11-06T08:00:00.000Z");
});
