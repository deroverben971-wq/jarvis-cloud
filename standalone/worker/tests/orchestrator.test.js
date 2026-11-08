import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlan } from "../src/agents/orchestrator.js";
import { scoreMemory } from "../src/services/memory.js";

test("planner output is constrained to enabled specialist roles", () => {
  const plan = normalizePlan(JSON.stringify({
    goal: "Prepare a comparison",
    tasks: [
      { agent: "researcher", objective: "Find relevant evidence" },
      { agent: "developer", objective: "Deploy the result" },
      { agent: "analyst", objective: "Compare the options" },
      { agent: "researcher", objective: "Duplicate assignment" }
    ]
  }));
  assert.equal(plan.goal, "Prepare a comparison");
  assert.deepEqual(plan.tasks.map((item) => item.agent), ["researcher", "analyst"]);
});

test("invalid planner output receives a safe default plan", () => {
  const plan = normalizePlan("I will now do the task.");
  assert.deepEqual(plan.tasks.map((item) => item.agent), ["researcher", "analyst"]);
});

test("memory retrieval score rewards relevant shared terms", () => {
  assert.ok(scoreMemory("Prefers a male voice for JARVIS", "JARVIS male voice") > 0);
  assert.equal(scoreMemory("Likes science fiction books", "calendar reminder time"), 0);
});
