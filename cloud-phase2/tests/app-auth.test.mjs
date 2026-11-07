import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedAppOrigin } from "../src/app-auth.mjs";

test("only exact configured app origins are allowed", () => {
  const env = { JARVIS_APP_ORIGIN: "https://jarvis.pages.dev, https://app.example.test" };
  assert.equal(isAllowedAppOrigin(new Request("https://worker.example/app/api/session", {
    headers: { Origin: "https://jarvis.pages.dev" }
  }), env), true);
  assert.equal(isAllowedAppOrigin(new Request("https://worker.example/app/api/session", {
    headers: { Origin: "https://app.example.test" }
  }), env), true);
  assert.equal(isAllowedAppOrigin(new Request("https://worker.example/app/api/session", {
    headers: { Origin: "https://evil.example" }
  }), env), false);
  assert.equal(isAllowedAppOrigin(new Request("https://worker.example/app/api/session", {
    headers: { Origin: "https://jarvis.pages.dev.attacker.example" }
  }), env), false);
  assert.equal(isAllowedAppOrigin(new Request("https://worker.example/app/api/session"), env), false);
});

test("trailing slash normalization does not broaden the origin", () => {
  const env = { JARVIS_APP_ORIGIN: "https://jarvis.pages.dev/" };
  assert.equal(isAllowedAppOrigin(new Request("https://worker.example/", {
    headers: { Origin: "https://jarvis.pages.dev" }
  }), env), true);
});
