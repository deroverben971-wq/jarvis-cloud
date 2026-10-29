/**
 * JARVIS Gmail outreach bridge.
 * Gmail Advanced Service scopes: gmail.send and gmail.metadata.
 * Sends messages and reads only reply headers, never message bodies.
 * Set Script Property JARVIS_GMAIL_SHARED_SECRET before deploying as a Web App.
 */
const JARVIS_GMAIL_SECRET_PROPERTY = "JARVIS_GMAIL_SHARED_SECRET";

function doGet() {
  return jsonOutput_({ ok: true, service: "JARVIS Gmail outreach bridge", method: "POST" });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const configured = PropertiesService.getScriptProperties().getProperty(JARVIS_GMAIL_SECRET_PROPERTY);
    if (!configured || !body.secret || !constantTimeEqual_(String(body.secret), configured)) {
      return jsonOutput_({ ok: false, error: "Unauthorized" });
    }
    const action = String(body.action || "");
    if (action === "ping") return jsonOutput_({ ok: true, service: "JARVIS Gmail outreach bridge" });
    if (action === "profile") {
      const profile = Gmail.Users.getProfile("me");
      return jsonOutput_({ ok: true, emailAddress: String(profile.emailAddress || "") });
    }
    if (action === "send_email") return sendInitialEmail_(body);
    if (action === "send_followup") return sendFollowup_(body);
    if (action === "check_replies") return checkReplies_(body);
    return jsonOutput_({ ok: false, error: "Unknown action" });
  } catch (error) {
    console.error("JARVIS Gmail bridge request failed:", error && error.name ? String(error.name).slice(0, 80) : "unknown error");
    return jsonOutput_({ ok: false, error: "Gmail request failed" });
  }
}

function sendInitialEmail_(body) {
  const to = validateEmail_(body.to);
  const subject = safeText_(body.subject, 200);
  const messageBody = safeText_(body.body, 5000);
  if (!to || !subject || !messageBody) return jsonOutput_({ ok: false, error: "Invalid recipient, subject, or message body" });
  const sent = Gmail.Users.Messages.send({ raw: buildRawMessage_(to, subject, messageBody, null) }, "me");
  return sentMetadata_(sent);
}

function sendFollowup_(body) {
  const to = validateEmail_(body.to);
  const subject = safeText_(body.subject, 200);
  const messageBody = safeText_(body.body, 3000);
  const threadId = safeText_(body.threadId, 300);
  const inReplyTo = safeText_(body.inReplyToMessageId, 500);
  if (!to || !subject || !messageBody || !threadId || !inReplyTo || /[\r\n]/.test(inReplyTo)) {
    return jsonOutput_({ ok: false, error: "Invalid follow-up details" });
  }
  const sent = Gmail.Users.Messages.send({
    raw: buildRawMessage_(to, subject, messageBody, inReplyTo),
    threadId: threadId
  }, "me");
  return sentMetadata_(sent);
}

function buildRawMessage_(to, subject, messageBody, inReplyTo) {
  const headers = [
    "To: " + to,
    "Subject: " + encodeHeader_(subject),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8"
  ];
  if (inReplyTo) {
    headers.push("In-Reply-To: " + inReplyTo);
    headers.push("References: " + inReplyTo);
  }
  const rawEmail = headers.join("\r\n") + "\r\n\r\n" + messageBody.replace(/\r?\n/g, "\r\n");
  return Utilities.base64EncodeWebSafe(rawEmail, Utilities.Charset.UTF_8).replace(/=+$/g, "");
}

function sentMetadata_(sent) {
  if (!sent || !sent.id || !sent.threadId) {
    return jsonOutput_({ ok: false, error: "Gmail did not confirm a sent message" });
  }
  const message = Gmail.Users.Messages.get("me", sent.id, {
    format: "metadata",
    metadataHeaders: ["Message-ID", "Subject", "To", "From", "Date"]
  });
  const headers = headersObject_(message.payload && message.payload.headers);
  const rfc822MessageId = String(headers["message-id"] || "");
  if (!rfc822MessageId) {
    return jsonOutput_({ ok: false, error: "Message may have been sent, but Gmail headers were unavailable. Check Sent before retrying." });
  }
  return jsonOutput_({
    ok: true,
    messageId: String(sent.id),
    threadId: String(sent.threadId),
    rfc822MessageId: rfc822MessageId,
    subject: String(headers.subject || "")
  });
}

function checkReplies_(body) {
  const profile = Gmail.Users.getProfile("me");
  const ownEmail = String(profile.emailAddress || "").toLowerCase();
  const items = Array.isArray(body.threads) ? body.threads.slice(0, 25) : [];
  const replies = [];
  const errors = [];
  items.forEach(function (item) {
    const threadId = safeText_(item && item.threadId, 300);
    const afterMs = Number(item && item.afterMs);
    if (!threadId || !Number.isFinite(afterMs)) {
      errors.push({ threadId: threadId, error: "Invalid thread check" });
      return;
    }
    try {
      const thread = Gmail.Users.Threads.get("me", threadId, {
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date", "Message-ID"]
      });
      let newest = null;
      (thread.messages || []).forEach(function (message) {
        const timestamp = Number(message.internalDate || 0);
        const headers = headersObject_(message.payload && message.payload.headers);
        const sender = extractEmail_(headers.from || "").toLowerCase();
        if (timestamp > afterMs && sender && sender !== ownEmail) {
          if (!newest || timestamp > newest.timestamp) {
            newest = {
              threadId: threadId,
              from: String(headers.from || "").slice(0, 254),
              subject: String(headers.subject || "(no subject)").slice(0, 200),
              date: headers.date || new Date(timestamp).toISOString(),
              messageId: String(headers["message-id"] || "").slice(0, 500),
              timestamp: timestamp
            };
          }
        }
      });
      if (newest) replies.push(newest);
    } catch (error) {
      errors.push({ threadId: threadId, error: "Unable to read thread metadata" });
    }
  });
  return jsonOutput_({ ok: true, replies: replies, errors: errors });
}

function headersObject_(headers) {
  const out = {};
  (headers || []).forEach(function (header) {
    out[String(header.name || "").toLowerCase()] = String(header.value || "");
  });
  return out;
}

function extractEmail_(fromHeader) {
  const match = /<([^>]+)>/.exec(String(fromHeader || ""));
  return String(match ? match[1] : fromHeader || "").trim().replace(/^mailto:/i, "");
}

function encodeHeader_(value) {
  const bytes = Utilities.newBlob(String(value), "text/plain", "subject.txt").getBytes();
  return "=?UTF-8?B?" + Utilities.base64Encode(bytes) + "?=";
}

function validateEmail_(value) {
  const email = String(value || "").trim();
  if (email.length > 254 || /[\r\n]/.test(email)) return "";
  return /^[A-Z0-9.!#$%&'*+/=?^_{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(email) ? email : "";
}

function safeText_(value, maxLength) {
  const text = String(value || "").trim();
  return text.length <= maxLength ? text : "";
}

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
