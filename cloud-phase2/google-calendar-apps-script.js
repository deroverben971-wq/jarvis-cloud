/**
 * JARVIS Google Calendar bridge.
 *
 * Deploy as a Web App that executes as you. Store JARVIS_SHARED_SECRET in
 * Project Settings > Script properties; do not put the secret in this file.
 * Only the configured Cloudflare Worker should know the matching secret.
 */

const SECRET_PROPERTY = "JARVIS_SHARED_SECRET";
const TIME_ZONE = "Asia/Manila";

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
      const calendar = CalendarApp.getDefaultCalendar();
      return jsonOutput({ ok: true, calendar: calendar.getName(), timeZone: TIME_ZONE });
    }

    const calendar = CalendarApp.getDefaultCalendar();
    if (action === "list_events") {
      const days = Math.min(14, Math.max(1, Number(body.days) || 7));
      const start = new Date();
      const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
      const events = calendar.getEvents(start, end).slice(0, 20).map(function (event) {
        return {
          id: event.getId(),
          title: event.getTitle(),
          start: event.getStartTime().toISOString(),
          end: event.getEndTime().toISOString(),
          location: event.getLocation() || ""
        };
      });
      return jsonOutput({ ok: true, calendar: calendar.getName(), events: events });
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
      const event = calendar.createEvent(title, start, end, { description: description });
      if (body.popupReminderMinutes !== undefined) {
        const minutes = Number(body.popupReminderMinutes);
        if (Number.isInteger(minutes) && minutes >= 0 && minutes <= 1440) {
          event.addPopupReminder(minutes);
        }
      }
      return jsonOutput({
        ok: true,
        event: {
          id: event.getId(),
          title: event.getTitle(),
          start: event.getStartTime().toISOString(),
          end: event.getEndTime().toISOString()
        }
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
