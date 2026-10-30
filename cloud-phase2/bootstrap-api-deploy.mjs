import fs from "node:fs/promises";
import path from "node:path";

const token = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const bundleDir = process.argv[2] || "/tmp/jarvis-cloud-dry-run";
const checkOnly = process.argv.includes("--check-only");

if (!token || !accountId) {
  throw new Error("Missing Cloudflare deployment credentials. Values were not printed.");
}

const configPath = new URL("./wrangler.jsonc", import.meta.url);
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
const workerName = config.name;
const apiBase = "https://api.cloudflare.com/client/v4/accounts/" + accountId;

async function api(pathname, options = {}) {
  let response;
  try {
    response = await fetch(apiBase + pathname, {
      ...options,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error("Cloudflare API request failed (" + (error?.name || "network error") + ").");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Cloudflare API returned a non-JSON response (HTTP " + response.status + ").");
  }

  if (!response.ok || payload?.success === false) {
    const details = Array.isArray(payload?.errors)
      ? payload.errors.map((item) => String(item.code ?? "?") + ": " + String(item.message ?? "API error")).join("; ")
      : "";
    throw new Error("Cloudflare API " + pathname + " failed (HTTP " + response.status + ")" + (details ? ": " + details : ""));
  }

  return payload.result;
}

function cronList(result) {
  return (result?.schedules || []).map((item) => item.cron).sort();
}

function retainedBindingKeys(rows) {
  const retainedTypes = new Set(["plain_text", "json", "secret_text", "secret_key"]);
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => retainedTypes.has(item.type))
    .map((item) => item.type + ":" + item.name)
    .sort();
}

async function verifyBindings(rows, databaseId) {
  if (!Array.isArray(rows)) {
    throw new Error("Cloudflare returned an unexpected bindings format; deployment stopped safely.");
  }

  const retainedTypes = new Set(["plain_text", "json", "secret_text", "secret_key"]);
  const managedRows = rows.filter((item) => !retainedTypes.has(item.type));
  const unexpected = managedRows.filter(
    (item) => !((item.name === "DB" && item.type === "d1") || (item.name === "AI" && item.type === "ai"))
  );

  if (unexpected.length || managedRows.length !== 2) {
    throw new Error(
      "The live Worker has resource bindings beyond the configured DB and AI bindings. No deployment was made."
    );
  }

  const d1 = managedRows.find((item) => item.name === "DB" && item.type === "d1");
  const ai = managedRows.find((item) => item.name === "AI" && item.type === "ai");
  const liveDatabaseId = d1?.id ?? d1?.database_id;

  if (!d1 || liveDatabaseId !== databaseId || !ai) {
    throw new Error("The live DB/AI bindings do not exactly match the checked-in deployment configuration. No deployment was made.");
  }
}

const service = await api("/workers/services/" + workerName);
const defaultEnvironment = service?.default_environment;
if (!defaultEnvironment?.script) {
  throw new Error("Could not read the existing Worker's deployment metadata.");
}

const environmentName = defaultEnvironment.environment || "production";
if (environmentName !== "production") {
  throw new Error('Expected the production Worker environment, but Cloudflare reported "' + environmentName + '". No deployment was made.');
}
const deploymentSource = defaultEnvironment.script.last_deployed_from || "unknown";

console.log('Current Worker deployment source: "' + deploymentSource + '".');
console.log("Using the direct Workers Script Upload API to avoid Wrangler's dashboard metadata lookup.");
console.log("The token remains limited to Individual Workers Editor for this Worker.");

const databases = config.d1_databases || [];
if (databases.length !== 1 || databases[0].binding !== "DB" || !databases[0].database_id) {
  throw new Error("Unexpected D1 configuration; deployment stopped safely.");
}
if (config.ai?.binding !== "AI") {
  throw new Error("Unexpected AI binding configuration; deployment stopped safely.");
}

const environmentPath = "/workers/services/" + workerName + "/environments/" + environmentName;
const [environmentData, liveBindings, schedulesBefore, subdomainBefore] = await Promise.all([
  api(environmentPath),
  api(environmentPath + "/bindings"),
  api("/workers/scripts/" + workerName + "/schedules"),
  api(environmentPath + "/subdomain")
]);

await verifyBindings(liveBindings, databases[0].database_id);
const retainedBindingsBefore = retainedBindingKeys(liveBindings);

const expectedCrons = (config.triggers?.crons || []).slice().sort();
const currentCrons = cronList(schedulesBefore);
for (const cron of expectedCrons) {
  if (!currentCrons.includes(cron)) {
    throw new Error('The live Cron schedule "' + cron + '" is missing. No deployment was made.');
  }
}
if (subdomainBefore?.enabled !== true) {
  throw new Error("The production workers.dev address is not enabled. No deployment was made.");
}

const mainModule = path.basename(config.main);
const bundlePath = path.join(bundleDir, mainModule);
const bundle = await fs.readFile(bundlePath).catch(() => null);
if (!bundle) {
  throw new Error("The dry-run bundle " + mainModule + " was not found. No deployment was made.");
}

const liveScript = environmentData?.script || {};
const configuredBindings = [
  { type: "d1", name: databases[0].binding, id: databases[0].database_id },
  { type: "ai", name: config.ai.binding }
];

const metadata = {
  main_module: mainModule,
  bindings: configuredBindings,
  compatibility_date: config.compatibility_date,
  keep_bindings: ["plain_text", "json", "secret_text", "secret_key"],
  observability: {
    ...(liveScript.observability || {}),
    ...(config.observability || {})
  },
  annotations: {
    "workers/message": "JARVIS Cloud Phase 2 GitHub Actions deployment",
    "workers/commit_sha": process.env.GITHUB_SHA || ""
  }
};

// Preserve dashboard-managed settings that are not declared locally.
if (Array.isArray(liveScript.compatibility_flags)) metadata.compatibility_flags = liveScript.compatibility_flags;
if (Array.isArray(liveScript.tags)) metadata.tags = liveScript.tags;
if (typeof liveScript.logpush === "boolean") metadata.logpush = liveScript.logpush;
if (Array.isArray(liveScript.tail_consumers)) metadata.tail_consumers = liveScript.tail_consumers;
if (Array.isArray(liveScript.streaming_tail_consumers)) metadata.streaming_tail_consumers = liveScript.streaming_tail_consumers;
if (liveScript.limits) metadata.limits = liveScript.limits;
if (liveScript.cache_options) metadata.cache_options = liveScript.cache_options;
if (liveScript.placement_mode) metadata.placement = { mode: liveScript.placement_mode };
if (liveScript.has_assets === true) metadata.keep_assets = true;
if (liveScript.usage_model) metadata.usage_model = liveScript.usage_model;

if (checkOnly) {
  console.log("READ-ONLY PREFLIGHT PASSED. No Worker upload or production change was made.");
  process.exit(0);
}

const form = new FormData();
form.set("metadata", JSON.stringify(metadata));
form.set(
  mainModule,
  new Blob([bundle], { type: "application/javascript+module" }),
  mainModule
);

console.log("Preflight checks passed:");
console.log("- D1 DB binding and AI binding match the live Worker.");
console.log("- Existing variables and secrets will be retained.");
console.log("- Cron schedules detected: " + (currentCrons.join(", ") || "none") + ".");
console.log("- workers.dev enabled: " + subdomainBefore.enabled + "; preview URLs enabled: " + Boolean(subdomainBefore.previews_enabled) + ".");
console.log("- No database migration or data operation will be performed.");

const upload = await api("/workers/scripts/" + workerName + "/versions?bindings_inherit=strict", {
  method: "POST",
  body: form
});

const versionId = upload?.id;
if (typeof versionId !== "string" || !/^[0-9a-f-]{36}$/i.test(versionId)) {
  throw new Error("Cloudflare did not return a valid uploaded version ID. No production deployment was attempted.");
}
console.log("Cloudflare accepted a new, not-yet-deployed Worker version. Startup time: " + (upload?.startup_time_ms ?? "not reported") + " ms.");
console.log("Existing variable and secret bindings were requested to be retained from the previous upload.");

const deployment = await api("/workers/scripts/" + workerName + "/deployments", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    strategy: "percentage",
    versions: [{ percentage: 100, version_id: versionId }],
    annotations: {
      "workers/message": "JARVIS Cloud Phase 2 GitHub Actions deployment",
      "workers/triggered_by": "github-actions"
    }
  })
});

const deployedVersion = (deployment?.versions || []).find((item) => item.version_id === versionId);
if (!deployedVersion || deployedVersion.percentage !== 100) {
  throw new Error("Cloudflare accepted the deployment request but did not confirm 100% traffic on the uploaded version. Inspect Deployments before retrying.");
}

const [serviceAfter, schedulesAfter, subdomainAfter, bindingsAfter, deploymentList] = await Promise.all([
  api("/workers/services/" + workerName),
  api("/workers/scripts/" + workerName + "/schedules"),
  api(environmentPath + "/subdomain"),
  api(environmentPath + "/bindings"),
  api("/workers/scripts/" + workerName + "/deployments")
]);

const sourceAfter = serviceAfter?.default_environment?.script?.last_deployed_from || "unknown";
if (JSON.stringify(cronList(schedulesAfter)) !== JSON.stringify(currentCrons)) {
  throw new Error("The upload succeeded, but Cron schedules changed unexpectedly. Stop and inspect the schedule settings before another deployment.");
}
if (Boolean(subdomainAfter?.enabled) !== Boolean(subdomainBefore?.enabled) ||
    Boolean(subdomainAfter?.previews_enabled) !== Boolean(subdomainBefore?.previews_enabled)) {
  throw new Error("The upload succeeded, but the workers.dev or preview setting changed unexpectedly.");
}
await verifyBindings(bindingsAfter, databases[0].database_id);
const retainedBindingsAfter = retainedBindingKeys(bindingsAfter);
if (JSON.stringify(retainedBindingsAfter) !== JSON.stringify(retainedBindingsBefore)) {
  throw new Error("The Worker variable/secret binding names changed unexpectedly. Stop and inspect the Worker settings before another deployment.");
}
const newestDeployment = Array.isArray(deploymentList)
  ? deploymentList[0]
  : (deploymentList?.deployments || [])[0];
const deployedVersionAfter = (newestDeployment?.versions || []).find((item) => item.version_id === versionId);
if (!deployedVersionAfter || deployedVersionAfter.percentage !== 100) {
  throw new Error("The uploaded version was not confirmed as the current 100% deployment. Inspect the Deployments page before retrying.");
}

console.log('Verified: Cloudflare reports last_deployed_from as "' + sourceAfter + '".');
console.log("Verified: new version is serving 100% of traffic.");
console.log("Verified: DB/AI bindings, existing variable/secret binding names, Cron schedules, and workers.dev settings are preserved.");
console.log("Future deployments through this GitHub workflow will use version upload plus explicit deployment.");
