/**
 * JARVIS Google Calendar bridge.
 *
 * Uses the Advanced Calendar service with the narrower calendar.events.owned
 * OAuth scope. Add the Calendar API under Services in Apps Script.
 * Store JARVIS_SHARED_SECRET under Project Settings > Script properties.
 */

const SECRET_PROPERTY = "JARVIS_SHARED_SECRET";
const TIME_ZONE = "Asia/Manila";
const CALENDAR_ID = "primary";

function doGet() {
  return jsonOutput({ ok: true, service: "JARVIS Google Calendar bridge", method: "POST" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const configuredSecret = PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY);
    if (!configuredSecret || !body.secret || !constantTimeEqual_(String(body.secret), configuredSecret)) {
      return jsonOutput({ ok: false, error: "Unauthorized" });
    }

    const action = String(body.action || "");
    if (action === "ping") {
      return jsonOutput({ ok: true, calendar: "primary", timeZone: TIME_ZONE });
    }

    if (action === "list_events") {
      const days = Math.min(14, Math.max(1, Number(body.days) || 7));
      const start = new Date();
      const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
      const result = Calendar.Events.list(CALENDAR_ID, {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 20
      });
      const events = (result.items || []).map(function (event) {
        return {
          id: event.id,
          title: event.summary || "(Untitled event)",
          start: event.start.dateTime || event.start.date,
          end: event.end.dateTime || event.end.date,
          location: event.location || "",
          allDay: !event.start.dateTime
        };
      });
      return jsonOutput({ ok: true, calendar: CALENDAR_ID, events: events });
    }

    if (action === "search_events") {
      const query = String(body.query || "").trim().slice(0, 100);
      if (query.length < 2) {
        return jsonOutput({ ok: false, error: "Search query must be at least 2 characters" });
      }
      const now = Date.now();
      const start = new Date(now - 365 * 24 * 60 * 60 * 1000);
      const end = new Date(now + 365 * 24 * 60 * 60 * 1000);
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const result = Calendar.Events.list(CALENDAR_ID, {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        q: query,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250
      });
      const events = (result.items || []).filter(function (event) {
        const title = String(event.summary || "(Untitled event)").toLowerCase();
        return terms.every(function (term) { return title.indexOf(term) !== -1; });
      }).slice(0, 5).map(function (event) {
        return {
          id: event.id,
          title: event.summary || "(Untitled event)",
          start: event.start.dateTime || event.start.date,
          end: event.end.dateTime || event.end.date,
          location: event.location || "",
          allDay: !event.start.dateTime
        };
      });
      return jsonOutput({ ok: true, calendar: CALENDAR_ID, events: events });
    }

    if (action === "create_event") {
      const title = String(body.title || "").trim().slice(0, 160);
      const description = String(body.description || "").trim().slice(0, 1000);
      const start = new Date(String(body.start || ""));
      const end = new Date(String(body.end || ""));
      if (!title || isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
        return jsonOutput({ ok: false, error: "Invalid event details" });
      }
      if (start.getTime() < Date.now() - 60 * 1000) {
        return jsonOutput({ ok: false, error: "Event start must be in the future" });
      }

      const eventResource = {
        summary: title,
        description: description,
        start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
        end: { dateTime: end.toISOString(), timeZone: TIME_ZONE }
      };
      if (body.popupReminderMinutes !== undefined) {
        const minutes = Number(body.popupReminderMinutes);
        if (Number.isInteger(minutes) && minutes >= 5 && minutes <= 40320) {
          eventResource.reminders = {
            useDefault: false,
            overrides: [{ method: "popup", minutes: minutes }]
          };
        }
      }
      const event = Calendar.Events.insert(eventResource, CALENDAR_ID);
      return jsonOutput({
        ok: true,
        event: {
          id: event.id,
          title: event.summary || title,
          start: event.start.dateTime || event.start.date,
          end: event.end.dateTime || event.end.date
        }
      });
    }

    if (action === "delete_event") {
      const eventId = String(body.eventId || "").trim().slice(0, 256);
      const expectedTitle = String(body.expectedTitle || "").trim().slice(0, 160);
      const expectedStart = String(body.expectedStart || "").trim();
      if (!eventId || !expectedTitle || !expectedStart) {
        return jsonOutput({ ok: false, error: "Missing event confirmation details" });
      }

      const existing = Calendar.Events.get(CALENDAR_ID, eventId);
      const actualTitle = existing.summary || "(Untitled event)";
      const actualStart = existing.start.dateTime || existing.start.date;
      if (actualTitle !== expectedTitle || actualStart !== expectedStart) {
        return jsonOutput({ ok: false, error: "The event changed after confirmation was prepared. Search again before deleting." });
      }

      Calendar.Events.remove(CALENDAR_ID, eventId);
      return jsonOutput({
        ok: true,
        deletedEvent: { title: actualTitle, start: actualStart }
      });
    }

    return jsonOutput({ ok: false, error: "Unknown action" });
  } catch (error) {
    console.error("JARVIS Calendar bridge error: " + (error && error.message ? error.message : "unknown"));
    return jsonOutput({ ok: false, error: "Calendar request failed" });
  }
}

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
