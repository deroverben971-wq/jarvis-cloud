import test from "node:test";
import assert from "node:assert/strict";
import { validateDeploymentConfig } from "../scripts/deployment-readiness.mjs";

const readyConfig = {
  name: "jarvis-standalone-api",
  main: "src/index.js",
  ai: { binding: "AI" },
  d1_databases: [{
    binding: "DB",
    database_name: "jarvis-standalone-db",
    database_id: "123e4567-e89b-42d3-a456-426614174000",
    migrations_dir: "migrations"
  }],
  triggers: { crons: ["* * * * *"] },
  vars: {
    JARVIS_AI_MODEL: "@cf/zai-org/glm-4.7-flash",
    JARVIS_DAILY_AI_CALL_CAP: "24",
    APP_ORIGIN: "http://tauri.localhost"
  }
};

test("deployment preflight passes a complete free-only local configuration", () => {
  const result = validateDeploymentConfig(readyConfig, ["0001_initial.sql", "0002_auth_rate_limits.sql"]);
  assert.equal(result.ready, true);
  assert.equal(result.checks.filter((item) => item.status === "FAIL").length, 0);
  assert.ok(result.checks.some((item) => item.status === "MANUAL" && item.name === "Cloudflare account plan"));
});

test("deployment preflight blocks the checked-in placeholder D1 database ID", () => {
  const config = structuredClone(readyConfig);
  config.d1_databases[0].database_id = "REPLACE_WITH_D1_DATABASE_ID";
  const result = validateDeploymentConfig(config, ["0001_initial.sql"]);
  assert.equal(result.ready, false);
  assert.ok(result.checks.some((item) => item.name === "D1 database ID" && item.status === "FAIL"));
});

test("deployment preflight blocks unsupported models and increased app AI cap", () => {
  const config = structuredClone(readyConfig);
  config.vars.JARVIS_AI_MODEL = "@cf/some-paid-model";
  config.vars.JARVIS_DAILY_AI_CALL_CAP = "25";
  const result = validateDeploymentConfig(config, ["0001_initial.sql"]);
  assert.equal(result.ready, false);
  assert.ok(result.checks.some((item) => item.name === "AI model allowlist" && item.status === "FAIL"));
  assert.ok(result.checks.some((item) => item.name === "Daily application AI cap" && item.status === "FAIL"));
});

test("deployment preflight prevents invitation secrets being stored as plain vars", () => {
  const config = structuredClone(readyConfig);
  config.vars.REGISTRATION_INVITE_CODE = "do-not-commit";
  const result = validateDeploymentConfig(config, ["0001_initial.sql"]);
  assert.equal(result.ready, false);
  assert.ok(result.checks.some((item) => item.name === "Registration secret storage" && item.status === "FAIL"));
});

test("deployment preflight blocks missing Cron and migration files", () => {
  const config = structuredClone(readyConfig);
  config.triggers.crons = [];
  const result = validateDeploymentConfig(config, []);
  assert.equal(result.ready, false);
  assert.ok(result.checks.some((item) => item.name === "Reminder Cron" && item.status === "FAIL"));
  assert.ok(result.checks.some((item) => item.name === "D1 migrations" && item.status === "FAIL"));
});
