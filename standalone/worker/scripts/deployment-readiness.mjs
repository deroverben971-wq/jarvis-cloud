import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_MODELS = new Set([
  "@cf/zai-org/glm-4.7-flash",
  "@cf/google/gemma-4-26b-a4b-it"
]);

export function validateDeploymentConfig(config, migrationFiles = []) {
  const checks = [];
  const fail = (name, detail) => checks.push({ name, status: "FAIL", detail });
  const pass = (name, detail) => checks.push({ name, status: "PASS", detail });
  const manual = (name, detail) => checks.push({ name, status: "MANUAL", detail });

  if (config && typeof config.name === "string" && config.name.trim()) pass("Worker name", config.name);
  else fail("Worker name", "Set a non-empty Worker name.");

  if (config && typeof config.main === "string" && config.main.trim()) pass("Worker entry", config.main);
  else fail("Worker entry", "Set the Worker entry file.");

  if (config?.ai?.binding === "AI") pass("Workers AI binding", "AI binding is configured.");
  else fail("Workers AI binding", "Expected the AI binding named AI.");

  const database = Array.isArray(config?.d1_databases)
    ? config.d1_databases.find((item) => item?.binding === "DB")
    : null;
  const databaseId = String(database?.database_id || "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(databaseId)) {
    pass("D1 database ID", "DB binding has a UUID-shaped database ID.");
  } else {
    fail("D1 database ID", "DB binding is missing or still contains the placeholder. Create/configure the database yourself, then set database_id in wrangler.jsonc.");
  }

  if (database?.migrations_dir === "migrations" && migrationFiles.some((name) => /^000[0-9]+_.*\.sql$/.test(name))) {
    pass("D1 migrations", migrationFiles.filter((name) => name.endsWith(".sql")).sort().join(", "));
  } else {
    fail("D1 migrations", "The configured migrations directory or SQL migration files are missing.");
  }

  const cron = config?.triggers?.crons;
  if (Array.isArray(cron) && cron.includes("* * * * *")) pass("Reminder Cron", "One-minute schedule is configured.");
  else fail("Reminder Cron", "Expected the one-minute reminder Cron trigger.");

  const model = config?.vars?.JARVIS_AI_MODEL;
  if (ALLOWED_MODELS.has(model)) pass("AI model allowlist", model);
  else fail("AI model allowlist", "Choose one of the two source-allowlisted model IDs.");

  const dailyCap = Number(config?.vars?.JARVIS_DAILY_AI_CALL_CAP);
  if (Number.isInteger(dailyCap) && dailyCap >= 1 && dailyCap <= 24) pass("Daily application AI cap", String(dailyCap) + " calls maximum.");
  else fail("Daily application AI cap", "Set JARVIS_DAILY_AI_CALL_CAP to an integer from 1 through 24.");

  if (Object.hasOwn(config?.vars || {}, "REGISTRATION_INVITE_CODE")) {
    fail("Registration secret storage", "Remove REGISTRATION_INVITE_CODE from vars; it must be a Wrangler secret, never a committed variable.");
  } else {
    pass("Registration secret storage", "No invitation-code value is committed in vars.");
  }

  manual("Cloudflare account plan", "Check the account dashboard yourself and keep it on the free plan. Stop if setup asks for a paid upgrade or billing.");
  manual("Remote registration secret", "After setup, use wrangler secret list to confirm REGISTRATION_INVITE_CODE exists. Never print or share its value.");
  manual("Physical device test", "Test sign-in, microphone permission, speech output and reminder inbox on your own devices.");

  return { checks, ready: checks.every((item) => item.status !== "FAIL") };
}

async function main() {
  const configPath = path.join(ROOT, "wrangler.jsonc");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const migrationsDir = path.join(ROOT, config.d1_databases?.find((item) => item.binding === "DB")?.migrations_dir || "migrations");
  let migrationFiles = [];
  try { migrationFiles = await readdir(migrationsDir); } catch { /* reported by validation */ }

  const result = validateDeploymentConfig(config, migrationFiles);
  console.log("JARVIS standalone deployment preflight");
  console.log("This check is local/read-only. It does not create resources or deploy.");
  for (const check of result.checks) {
    const symbol = check.status === "PASS" ? "✓" : check.status === "FAIL" ? "✗" : "•";
    console.log(symbol + " [" + check.status + "] " + check.name + ": " + check.detail);
  }
  console.log("");
  console.log(result.ready ? "Local configuration checks passed. Complete the manual Cloudflare checks before deployment." : "NOT READY: fix the failed local checks before attempting deployment.");
  if (!result.ready) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Deployment preflight failed:", error?.message || "unknown error");
    process.exitCode = 1;
  });
}
