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
          .replace(/\\+/g, "-").replace(/\\//g, "_");
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
