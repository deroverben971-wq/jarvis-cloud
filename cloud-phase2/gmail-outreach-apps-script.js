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
    if (action === "capabilities") return jsonOutput_({ ok: true, capabilities: { sendIdempotency: true } });
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
  if (!to || !subject || !messageBody) {
    return jsonOutput_({ ok: false, error: "Invalid recipient, subject, or message body" });
  }

  const fingerprint = sendFingerprint_({
    action: "send_email",
    to: to.toLowerCase(),
    subject: subject,
    body: messageBody
  });

  return sendIdempotently_(body.idempotencyKey, fingerprint, function () {
    const sent = Gmail.Users.Messages.send({
      raw: buildRawMessage_(to, subject, messageBody, null)
    }, "me");
    return sentMetadataResult_(sent);
  });
}

function sendFollowup_(body) {
  const to = validateEmail_(body.to);
  const subject = safeText_(body.subject, 200);
  const messageBody = safeText_(body.body, 3000);
  const threadId = safeText_(body.threadId, 300);
  const inReplyTo = safeText_(body.inReplyToMessageId, 500);
  if (!to || !subject || !messageBody || !threadId || !inReplyTo || /[\\r\\n]/.test(inReplyTo)) {
    return jsonOutput_({ ok: false, error: "Invalid follow-up details" });
  }

  const fingerprint = sendFingerprint_({
    action: "send_followup",
    to: to.toLowerCase(),
    subject: subject,
    body: messageBody,
    threadId: threadId,
    inReplyToMessageId: inReplyTo
  });

  return sendIdempotently_(body.idempotencyKey, fingerprint, function () {
    const sent = Gmail.Users.Messages.send({
      raw: buildRawMessage_(to, subject, messageBody, inReplyTo),
      threadId: threadId
    }, "me");
    return sentMetadataResult_(sent);
  });
}

/**
 * Persist an operation key before calling Gmail. Replays of a confirmed send
 * return the original receipt; replays of an uncertain attempt are blocked.
 * This is deliberately fail-closed because Gmail may accept a message even
 * when the network response is lost.
 */
function sendIdempotently_(keyValue, fingerprint, sendFunction) {
  const idempotencyKey = safeText_(keyValue, 180);
  if (!/^[A-Za-z0-9:_-]{12,180}$/.test(idempotencyKey)) {
    return jsonOutput_({ ok: false, error: "A valid idempotency key is required. No email was sent." });
  }

  const propertyKey = "JARVIS_SEND_" + sha256Hex_(idempotencyKey);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return jsonOutput_({ ok: false, error: "Gmail send lock is busy. No second send was attempted; check the send status." });
  }

  const properties = PropertiesService.getScriptProperties();
  try {
    const stored = properties.getProperty(propertyKey);
    if (stored) {
      let previous;
      try {
        previous = JSON.parse(stored);
      } catch (error) {
        return jsonOutput_({ ok: false, error: "A previous send record is unreadable. Check Gmail Sent; no second send was attempted." });
      }
      if (previous.fingerprint !== fingerprint) {
        return jsonOutput_({ ok: false, error: "This idempotency key was already used for different message content. No email was sent." });
      }
      if (previous.status === "sent" && previous.response && previous.response.ok === true) {
        return jsonOutput_({
          ok: true,
          messageId: previous.response.messageId,
          threadId: previous.response.threadId,
          rfc822MessageId: previous.response.rfc822MessageId,
          subject: previous.response.subject,
          replayed: true
        });
      }
      return jsonOutput_({
        ok: false,
        error: "A previous attempt for this message is recorded as " +
          String(previous.status || "unknown") +
          ". Check Gmail Sent before any manual recovery; no second send was attempted."
      });
    }

    properties.setProperty(propertyKey, JSON.stringify({
      status: "sending",
      fingerprint: fingerprint,
      startedAt: new Date().toISOString()
    }));
  } finally {
    lock.releaseLock();
  }

  let result;
  try {
    result = sendFunction();
    if (!result || result.ok !== true) {
      result = {
        ok: false,
        error: String(result && result.error
          ? result.error
          : "Gmail did not confirm the send. Check Gmail Sent before retrying.")
      };
    }
  } catch (error) {
    result = {
      ok: false,
      error: "Gmail send outcome is uncertain. Check Gmail Sent before retrying."
    };
  }

  // If the final ledger write is interrupted, the earlier "sending" record
  // remains and will still block a duplicate attempt.
  const finishLock = LockService.getScriptLock();
  if (finishLock.tryLock(5000)) {
    try {
      const latestRaw = properties.getProperty(propertyKey);
      let latest = null;
      try {
        latest = latestRaw ? JSON.parse(latestRaw) : null;
      } catch (error) {
        latest = null;
      }
      if (latest && latest.fingerprint === fingerprint && latest.status === "sending") {
        properties.setProperty(propertyKey, JSON.stringify({
          status: result.ok ? "sent" : "uncertain",
          fingerprint: fingerprint,
          startedAt: latest.startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          response: result
        }));
        pruneSendLedger_(properties);
      }
    } finally {
      finishLock.releaseLock();
    }
  }

  return jsonOutput_(result);
}

function sendFingerprint_(request) {
  return sha256Hex_(JSON.stringify(request));
}

function sha256Hex_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (byte) {
    return ("0" + ((byte & 255).toString(16))).slice(-2);
  }).join("");
}

function pruneSendLedger_(properties) {
  const all = properties.getProperties();
  const entries = [];
  Object.keys(all).forEach(function (key) {
    if (key.indexOf("JARVIS_SEND_") !== 0) return;
    try {
      const item = JSON.parse(all[key]);
      if (item.status === "sent") {
        entries.push({
          key: key,
          at: Date.parse(item.updatedAt || item.startedAt || "") || 0
        });
      }
    } catch (error) {
      // Preserve unreadable records; they must continue blocking re-sends.
    }
  });

  // Keep a rolling ledger of up to 1,000 confirmed sends to stay within
  // Apps Script property storage limits. Uncertain/sending records are never
  // pruned automatically.
  if (entries.length <= 1000) return;
  entries.sort(function (a, b) { return a.at - b.at; });
  const removeCount = entries.length - 900;
  entries.slice(0, removeCount).forEach(function (item) {
    properties.deleteProperty(item.key);
  });
}

function sentMetadataResult_(sent) {
  if (!sent || !sent.id || !sent.threadId) {
    return { ok: false, error: "Gmail did not confirm a sent message. Check Gmail Sent before retrying." };
  }

  try {
    const message = Gmail.Users.Messages.get("me", sent.id, {
      format: "metadata",
      metadataHeaders: ["Message-ID", "Subject", "To", "From", "Date"]
    });
    const headers = headersObject_(message.payload && message.payload.headers);
    const rfc822MessageId = String(headers["message-id"] || "");
    if (!rfc822MessageId) {
      return { ok: false, error: "Message may have been sent, but Gmail headers were unavailable. Check Sent before retrying." };
    }
    return {
      ok: true,
      messageId: String(sent.id),
      threadId: String(sent.threadId),
      rfc822MessageId: rfc822MessageId,
      subject: String(headers.subject || "")
    };
  } catch (error) {
    return { ok: false, error: "Message may have been sent, but its receipt could not be read. Check Gmail Sent before retrying." };
  }
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
