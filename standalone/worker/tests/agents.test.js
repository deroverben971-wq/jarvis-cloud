import test from "node:test";
import assert from "node:assert/strict";
import { AGENTS, getAgentDefinition, getEnabledAgents, isRunnableLlmAgent } from "../src/agents/registry.js";
import { buildRunInputMetadata, extractJsonObject, extractText, selectFreeModel } from "../src/agents/engine.js";

test("agent registry exposes the planned core roles", () => {
  for (const role of ["core", "coordinator", "planner", "researcher", "analyst", "memory", "verifier", "safety_gate"]) {
    assert.ok(getAgentDefinition(role), "missing role: " + role);
  }
  assert.ok(getEnabledAgents().length >= 8);
});

test("only enabled LLM roles can call the model", () => {
  assert.equal(isRunnableLlmAgent("planner"), true);
  assert.equal(isRunnableLlmAgent("researcher"), true);
  assert.equal(isRunnableLlmAgent("personal_assistant"), false);
  assert.equal(isRunnableLlmAgent("memory"), false);
  assert.equal(isRunnableLlmAgent("unknown"), false);
});

test("free model selection rejects models outside the allowlist", () => {
  assert.equal(selectFreeModel(undefined), "@cf/zai-org/glm-4.7-flash");
  assert.equal(selectFreeModel("@cf/google/gemma-4-26b-a4b-it"), "@cf/google/gemma-4-26b-a4b-it");
  assert.throws(() => selectFreeModel("@cf/moonshotai/kimi-k2.6"), { code: "MODEL_NOT_ALLOWED" });
});

test("model response text extraction handles Workers AI response shapes", () => {
  assert.equal(extractText({ response: "hello" }), "hello");
  assert.equal(extractText({ choices: [{ message: { content: "world" } }] }), "world");
});

test("JSON extraction accepts plain and surrounded JSON", () => {
  assert.deepEqual(extractJsonObject('{"goal":"x"}'), { goal: "x" });
  assert.deepEqual(extractJsonObject('Plan: {"goal":"z"} done.'), { goal: "z" });
  assert.equal(extractJsonObject("not json"), null);
});

test("tool agents stay disabled until approval-gated tools are built", () => {
  assert.equal(AGENTS.developer.enabled, false);
  assert.equal(AGENTS.personal_assistant.enabled, false);
});


test("agent run metadata records prompt sizes without duplicating private prompt text", () => {
  const secretText = "private user conversation content";
  const metadata = buildRunInputMetadata({
    systemPrompt: "system instruction",
    userPrompt: secretText,
    maxTokens: 620,
    temperature: 0.2
  });

  assert.equal(metadata.promptSchema, "jarvis-agent-v1");
  assert.equal(metadata.systemPromptChars, "system instruction".length);
  assert.equal(metadata.userPromptChars, secretText.length);
  assert.equal(metadata.maxTokens, 620);
  assert.equal(metadata.temperature, 0.2);
  assert.equal(JSON.stringify(metadata).includes(secretText), false);
});
