import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createHash } from "node:crypto";

const scriptSource = await readFile(
  new URL("../gmail-outreach-apps-script.js", import.meta.url),
  "utf8"
);

function createBridge(options = {}) {
  const properties = new Map();
  let sendCalls = 0;
  let onSend = null;
  let throwAfterSend = Boolean(options.throwAfterSend);
  const context = {
    console,
    Date,
    JSON,
    Math,
    String,
    Array,
    Object,
    RegExp,
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) {
            return properties.has(key) ? properties.get(key) : null;
          },
          setProperty(key, value) {
            properties.set(key, String(value));
          },
          deleteProperty(key) {
            properties.delete(key);
          },
          getProperties() {
            return Object.fromEntries(properties.entries());
          }
        };
      }
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock() { return true; },
          releaseLock() {}
        };
      }
    },
    Utilities: {
      Charset: { UTF_8: "UTF-8" },
      DigestAlgorithm: { SHA_256: "SHA_256" },
      computeDigest(_algorithm, value) {
        return Array.from(createHash("sha256").update(String(value), "utf8").digest())
          .map(byte => byte > 127 ? byte - 256 : byte);
      },
      newBlob(value) {
        return { getBytes: () => Array.from(Buffer.from(String(value), "utf8")) };
      },
      base64Encode(bytes) {
        return Buffer.from(bytes.map(byte => byte < 0 ? byte + 256 : byte)).toString("base64");
      },
      base64EncodeWebSafe(value) {
        return Buffer.from(String(value), "utf8").toString("base64")
          .replace(/\+/g, "-").replace(/\//g, "_");
      }
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput(value) {
        return {
          content: String(value),
          setMimeType() { return this; },
          getContent() { return this.content; }
        };
      }
    },
    Gmail: {
      Users: {
        getProfile() { return { emailAddress: "jarvis@example.com" }; },
        Messages: {
          send() {
            sendCalls += 1;
            if (typeof onSend === "function") onSend();
            if (throwAfterSend) throw new Error("simulated connection loss");
            return { id: "message-" + sendCalls, threadId: "thread-" + sendCalls };
          },
          get(_user, id) {
            return {
              payload: {
                headers: [
                  { name: "Message-ID", value: "<" + id + "@mail.example>" },
                  { name: "Subject", value: "Approved message" }
                ]
              }
            };
          }
        },
        Threads: {
          get(_user, threadId, options) {
            context.lastThreadRead = { threadId, options };
            return { messages: context.threadMessages || [] };
          }
        }
      }
    }
  };
  vm.runInNewContext(scriptSource, context, { filename: "gmail-outreach-apps-script.js" });
  return {
    context,
    calls: () => sendCalls,
    setOnSend(callback) { onSend = callback; },
    setThrowAfterSend(value) { throwAfterSend = value; },
    setScriptProperty(key, value) { properties.set(key, String(value)); },
    setThreadMessages(messages) { context.threadMessages = messages; },
    lastThreadRead: () => context.lastThreadRead,
    parse(output) { return JSON.parse(output.getContent()); }
  };
}

function initialRequest(overrides = {}) {
  return {
    idempotencyKey: "jarvis:chat-123:campaign-7:prospect-42:initial",
    to: "opted-in@example.com",
    subject: "Your requested update",
    body: "Hello. Here is the information you asked to receive.",
    ...overrides
  };
}

test("replaying a confirmed initial send returns its stored receipt without sending twice", () => {
  const bridge = createBridge();
  const request = initialRequest();

  const first = bridge.parse(bridge.context.sendInitialEmail_(request));
  const second = bridge.parse(bridge.context.sendInitialEmail_(request));

  assert.equal(first.ok, true);
  assert.equal(first.messageId, "message-1");
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(second.messageId, first.messageId);
  assert.equal(bridge.calls(), 1);
});

test("reusing an idempotency key with different content is blocked", () => {
  const bridge = createBridge();
  const request = initialRequest();

  const first = bridge.parse(bridge.context.sendInitialEmail_(request));
  const changed = bridge.parse(bridge.context.sendInitialEmail_({
    ...request,
    body: "Different email content."
  }));

  assert.equal(first.ok, true);
  assert.equal(changed.ok, false);
  assert.match(changed.error, /different message content/i);
  assert.equal(bridge.calls(), 1);
});

test("a concurrent duplicate request is blocked while the first send is in progress", () => {
  const bridge = createBridge();
  const request = initialRequest();
  let replayDuringSend;

  bridge.setOnSend(() => {
    replayDuringSend = bridge.parse(bridge.context.sendInitialEmail_(request));
  });

  const first = bridge.parse(bridge.context.sendInitialEmail_(request));

  assert.equal(first.ok, true);
  assert.equal(replayDuringSend.ok, false);
  assert.match(replayDuringSend.error, /previous attempt.*sending/i);
  assert.equal(bridge.calls(), 1);
});

test("an interrupted/ambiguous Gmail send is not retried with the same key", () => {
  const bridge = createBridge({ throwAfterSend: true });
  const request = initialRequest();

  const first = bridge.parse(bridge.context.sendInitialEmail_(request));
  const second = bridge.parse(bridge.context.sendInitialEmail_(request));

  assert.equal(first.ok, false);
  assert.match(first.error, /outcome is uncertain/i);
  assert.equal(second.ok, false);
  assert.match(second.error, /previous attempt.*uncertain/i);
  assert.equal(bridge.calls(), 1);
});

test("follow-up sends use the same idempotency protection", () => {
  const bridge = createBridge();
  const request = {
    idempotencyKey: "jarvis:chat-123:campaign-7:prospect-42:followup-1",
    to: "opted-in@example.com",
    subject: "Re: Your requested update",
    body: "Following up once with the information you requested.",
    threadId: "thread-existing",
    inReplyToMessageId: "<prior-message@mail.example>"
  };

  const first = bridge.parse(bridge.context.sendFollowup_(request));
  const second = bridge.parse(bridge.context.sendFollowup_(request));

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(bridge.calls(), 1);
});



test("follow-up validator rejects actual newline characters but accepts ordinary r and n letters", () => {
  const bridge = createBridge();
  const valid = {
    idempotencyKey: "jarvis:chat-123:campaign-7:prospect-43:followup-1",
    to: "opted-in@example.com",
    subject: "Re: Your requested update",
    body: "Following up once.",
    threadId: "thread-existing",
    inReplyToMessageId: "<prior-message@mail.example>"
  };
  const accepted = bridge.parse(bridge.context.sendFollowup_(valid));
  const rejected = bridge.parse(bridge.context.sendFollowup_({
    ...valid,
    idempotencyKey: "jarvis:chat-123:campaign-7:prospect-44:followup-1",
    inReplyToMessageId: "<prior-message@mail.example>\nInjected: value"
  }));

  assert.equal(accepted.ok, true);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /invalid follow-up details/i);
  assert.equal(bridge.calls(), 1);
});

test("the authenticated bridge advertises duplicate-send protection to the Worker", () => {
  const bridge = createBridge();
  bridge.setScriptProperty("JARVIS_GMAIL_SHARED_SECRET", "test-shared-secret");

  const result = bridge.parse(bridge.context.doPost({
    postData: {
      contents: JSON.stringify({
        secret: "test-shared-secret",
        action: "capabilities"
      })
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.capabilities.sendIdempotency, true);
});


test("reply checker reads headers only, ignores the sender's own messages, and detects a later external reply", () => {
  const bridge = createBridge();
  const afterMs = Date.parse("2026-11-02T01:00:00.000Z");
  bridge.setThreadMessages([
    {
      internalDate: String(afterMs + 1000),
      payload: { headers: [
        { name: "From", value: "JARVIS <jarvis@example.com>" },
        { name: "Subject", value: "JARVIS Gmail self-test" },
        { name: "Date", value: "Mon, 2 Nov 2026 09:00:01 +0800" },
        { name: "Message-ID", value: "<self@mail.example>" }
      ] }
    },
    {
      internalDate: String(afterMs + 5000),
      payload: { headers: [
        { name: "From", value: "Tester <tester@example.net>" },
        { name: "Subject", value: "Re: Approved message" },
        { name: "Date", value: "Mon, 2 Nov 2026 09:00:05 +0800" },
        { name: "Message-ID", value: "<reply@mail.example>" }
      ] }
    }
  ]);

  const result = bridge.parse(bridge.context.checkReplies_({
    threads: [{ threadId: "thread-reply-test", afterMs }]
  }));

  assert.equal(result.ok, true);
  assert.equal(result.replies.length, 1);
  assert.equal(result.replies[0].threadId, "thread-reply-test");
  assert.equal(result.replies[0].from, "Tester <tester@example.net>");
  assert.equal(result.replies[0].messageId, "<reply@mail.example>");
  assert.deepEqual(
    JSON.parse(JSON.stringify(bridge.lastThreadRead().options)),
    { format: "metadata", metadataHeaders: ["From", "Subject", "Date", "Message-ID"] }
  );
});

test("the profile check reports whether duplicate-send protection is available", () => {
  const bridge = createBridge();
  bridge.setScriptProperty("JARVIS_GMAIL_SHARED_SECRET", "test-shared-secret");

  const result = bridge.parse(bridge.context.doPost({
    postData: {
      contents: JSON.stringify({
        secret: "test-shared-secret",
        action: "profile"
      })
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.emailAddress, "jarvis@example.com");
  assert.equal(result.capabilities.sendIdempotency, true);
});
