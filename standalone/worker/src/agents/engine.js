import { isRunnableLlmAgent } from "./registry.js";

export const DEFAULT_MODEL = "@cf/zai-org/glm-4.7-flash";
export const FREE_MODEL_ALLOWLIST = Object.freeze([
  "@cf/zai-org/glm-4.7-flash",
  "@cf/google/gemma-4-26b-a4b-it"
]);

export function selectFreeModel(configuredModel) {
  const candidate = configuredModel || DEFAULT_MODEL;
  if (!FREE_MODEL_ALLOWLIST.includes(candidate)) {
    const error = new Error("Configured model is not in the free-model allowlist.");
    error.code = "MODEL_NOT_ALLOWED";
    throw error;
  }
  return candidate;
}

export function extractText(modelResult) {
  if (typeof modelResult === "string") return modelResult.trim();
  const candidates = [
    modelResult?.response,
    modelResult?.result?.response,
    modelResult?.choices?.[0]?.message?.content,
    modelResult?.message?.content,
    modelResult?.output_text
  ];
  const value = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  return value ? value.trim() : JSON.stringify(modelResult ?? {});
}

export function extractJsonObject(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.trim();
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;
  } catch {
    // Continue: some models wrap JSON in explanatory text or a code fence.
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function buildRunInputMetadata({ systemPrompt, userPrompt, maxTokens, temperature }) {
  return {
    promptSchema: "jarvis-agent-v1",
    systemPromptChars: String(systemPrompt || "").length,
    userPromptChars: String(userPrompt || "").length,
    maxTokens,
    temperature
  };
}

function dailyCallCap(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

async function reserveDailyAiCall(db, cap) {
  const usageDay = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  const row = await db.prepare(
    "INSERT INTO usage_daily (usage_day, ai_calls, updated_at) VALUES (?, 1, ?) " +
    "ON CONFLICT(usage_day) DO UPDATE SET ai_calls = ai_calls + 1, updated_at = excluded.updated_at " +
    "WHERE usage_daily.ai_calls < ? RETURNING ai_calls"
  ).bind(usageDay, now, cap).first();

  if (!row) {
    const error = new Error("JARVIS reached its configured daily AI-call budget. No paid fallback is enabled.");
    error.code = "DAILY_AI_BUDGET_EXHAUSTED";
    throw error;
  }
  return { usageDay };
}

export async function runAgent({
  env, db, userId, taskId, agentId, systemPrompt, userPrompt, maxTokens = 500, temperature = 0.2
}) {
  if (!isRunnableLlmAgent(agentId)) {
    const error = new Error("Agent is not enabled for model execution.");
    error.code = "AGENT_NOT_RUNNABLE";
    throw error;
  }
  if (!env.AI || !db) {
    const error = new Error("AI or database binding is unavailable.");
    error.code = "SERVICE_NOT_CONFIGURED";
    throw error;
  }

  const model = selectFreeModel(env.JARVIS_AI_MODEL);
  const reservation = await reserveDailyAiCall(db, dailyCallCap(env.JARVIS_DAILY_AI_CALL_CAP));
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const inputJson = JSON.stringify(buildRunInputMetadata({ systemPrompt, userPrompt, maxTokens, temperature }));

  await db.prepare(
    "INSERT INTO agent_runs (id, task_id, user_id, agent_name, status, model, input_json, started_at) " +
    "VALUES (?, ?, ?, ?, 'running', ?, ?, ?)"
  ).bind(runId, taskId, userId, agentId, model, inputJson, startedAt).run();

  await db.prepare(
    "INSERT INTO usage_ledger (id, usage_day, user_id, task_id, agent_run_id, model, call_count, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, 1, ?)"
  ).bind(crypto.randomUUID(), reservation.usageDay, userId, taskId, runId, model, startedAt).run();

  try {
    const result = await env.AI.run(model, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: maxTokens,
      temperature
    });
    const text = extractText(result).slice(0, 16000);
    const finishedAt = new Date().toISOString();
    await db.prepare(
      "UPDATE agent_runs SET status = 'completed', output_json = ?, finished_at = ? WHERE id = ? AND user_id = ?"
    ).bind(JSON.stringify({ text }), finishedAt, runId, userId).run();

    return { runId, agentId, model, text, status: "completed" };
  } catch (cause) {
    const finishedAt = new Date().toISOString();
    const errorCode = cause?.code || "AI_PROVIDER_ERROR";
    await db.prepare(
      "UPDATE agent_runs SET status = 'failed', error_code = ?, output_json = ?, finished_at = ? WHERE id = ? AND user_id = ?"
    ).bind(errorCode, JSON.stringify({ message: "Model call failed." }), finishedAt, runId, userId).run();
    const error = new Error("A JARVIS agent could not complete its model request.");
    error.code = errorCode;
    throw error;
  }
}
