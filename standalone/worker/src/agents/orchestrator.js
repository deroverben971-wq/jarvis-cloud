import { runAgent, extractJsonObject } from "./engine.js";
import { retrieveRelevantMemories } from "../services/memory.js";

export function normalizePlan(text) {
  const parsed = extractJsonObject(text) || {};
  const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const seen = new Set();
  const tasks = [];
  for (const item of rawTasks) {
    const agent = String(item?.agent || "").toLowerCase();
    if (!["researcher", "analyst"].includes(agent) || seen.has(agent)) continue;
    const objective = String(item?.objective || "").trim().slice(0, 500);
    tasks.push({ agent, objective: objective || "Contribute an independent analysis." });
    seen.add(agent);
  }
  for (const agent of ["researcher", "analyst"]) {
    if (!seen.has(agent)) {
      tasks.push({
        agent,
        objective: agent === "researcher"
          ? "Identify relevant information, evidence, and uncertainties in supplied context."
          : "Analyze the request, assumptions, options, and tradeoffs."
      });
    }
  }
  return {
    goal: String(parsed.goal || "Answer the user's request accurately.").trim().slice(0, 500),
    tasks: tasks.slice(0, 2)
  };
}

function formatTranscript(messages) {
  return messages.slice(-8)
    .map((message) => String(message.role).toUpperCase() + ": " + String(message.content).slice(0, 1200))
    .join("\n");
}

function compactNotes(text) {
  const parsed = extractJsonObject(text);
  return parsed ? JSON.stringify(parsed) : String(text || "").slice(0, 5000);
}

async function saveMessage(db, conversationId, userId, role, content, agentName = null) {
  await db.prepare(
    "INSERT INTO messages (id, conversation_id, user_id, role, agent_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), conversationId, userId, role, agentName, String(content).slice(0, 16000), new Date().toISOString()).run();
}

export async function executeCollaborativeChat({ env, db, userId, message, conversationId }) {
  const now = new Date().toISOString();
  let activeConversationId = conversationId;
  if (activeConversationId) {
    const existing = await db.prepare(
      "SELECT id FROM conversations WHERE id = ? AND user_id = ?"
    ).bind(activeConversationId, userId).first();
    if (!existing) {
      const error = new Error("Conversation was not found.");
      error.code = "CONVERSATION_NOT_FOUND";
      throw error;
    }
  } else {
    activeConversationId = crypto.randomUUID();
    await db.prepare(
      "INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(activeConversationId, userId, message.slice(0, 72), now, now).run();
  }

  await saveMessage(db, activeConversationId, userId, "user", message);
  const history = await db.prepare(
    "SELECT role, content FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 8"
  ).bind(activeConversationId, userId).all();
  const transcript = formatTranscript((history.results || []).reverse());
  const memories = await retrieveRelevantMemories(db, userId, message, 5);
  const memoryContext = memories.length
    ? memories.map((item) => "- [" + item.kind + "] " + item.content).join("\n")
    : "No matching saved memories.";

  const taskId = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO tasks (id, user_id, conversation_id, goal, status, assigned_agent, max_steps, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', 'coordinator', 4, ?, ?)"
  ).bind(taskId, userId, activeConversationId, message.slice(0, 4000), now, now).run();

  const sharedContext = [
    "RECENT CONVERSATION:", transcript,
    "", "RELEVANT USER-APPROVED MEMORY:", memoryContext,
    "", "CURRENT REQUEST:", message
  ].join("\n");

  try {
    const planner = await runAgent({
      env, db, userId, taskId, agentId: "planner",
      systemPrompt: "You are JARVIS Planner. Return one JSON object with keys goal and tasks. Include exactly two task objects: one with agent='researcher' and one with agent='analyst'; each has an objective. Do not invent tools or claim external research.",
      userPrompt: sharedContext,
      maxTokens: 420
    });
    const plan = normalizePlan(planner.text);

    const specialistResults = await Promise.allSettled(plan.tasks.map((item) => runAgent({
      env, db, userId, taskId, agentId: item.agent,
      systemPrompt: item.agent === "researcher"
        ? "You are JARVIS Researcher. Use only supplied conversation, approved memory, and general knowledge. No live web search or external tools are available in this build. Never claim you searched, opened sources, or verified current facts. Separate supported observations from unknowns. Return concise JSON with findings, uncertainties, and live_research_needed."
        : "You are JARVIS Analyst. Independently analyze the request, assumptions, alternatives, and tradeoffs. Do not invent facts or sources. Return concise JSON with analysis, assumptions, and recommendation.",
      userPrompt: "Assigned objective: " + item.objective + "\n\n" + sharedContext,
      maxTokens: 620
    })));

    const contributions = specialistResults.map((result, index) => {
      const agent = plan.tasks[index].agent;
      if (result.status === "fulfilled") {
        return { agent, status: "completed", output: compactNotes(result.value.text), runId: result.value.runId };
      }
      return { agent, status: "failed", output: "Agent could not complete its task.", errorCode: result.reason?.code || "AGENT_FAILED" };
    });
    if (!contributions.some((item) => item.status === "completed")) {
      const error = new Error("The specialist agents could not complete this request.");
      error.code = "SPECIALISTS_FAILED";
      throw error;
    }

    const verifier = await runAgent({
      env, db, userId, taskId, agentId: "verifier",
      systemPrompt: "You are JARVIS Verifier. Produce the final user-facing answer from specialist outputs. Remove unsupported claims, identify important uncertainty, and do not imply live web research or tool execution occurred. Do not reveal private chain-of-thought; provide conclusions and concise reasons. Say what remains unverified.",
      userPrompt: JSON.stringify({ user_request: message, plan, specialist_contributions: contributions }),
      maxTokens: 900,
      temperature: 0.1
    });

    const reply = verifier.text.trim() || "I could not produce a verified response.";
    const finishedAt = new Date().toISOString();
    await saveMessage(db, activeConversationId, userId, "assistant", reply);
    await db.prepare(
      "UPDATE tasks SET status = 'completed', result_json = ?, updated_at = ?, completed_at = ? WHERE id = ? AND user_id = ?"
    ).bind(JSON.stringify({ plan, contributions, verifierRunId: verifier.runId }), finishedAt, finishedAt, taskId, userId).run();
    await db.prepare(
      "UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?"
    ).bind(finishedAt, activeConversationId, userId).run();

    return {
      conversationId: activeConversationId,
      taskId,
      reply,
      taskStatus: "completed",
      agents: [
        { agent: "planner", status: "completed", runId: planner.runId },
        ...contributions.map(({ agent, status, runId, errorCode }) => ({
          agent, status, ...(runId ? { runId } : {}), ...(errorCode ? { errorCode } : {})
        })),
        { agent: "verifier", status: "completed", runId: verifier.runId },
        { agent: "memory", status: "completed", matches: memories.length }
      ]
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await db.prepare(
      "UPDATE tasks SET status = 'failed', error_code = ?, updated_at = ?, completed_at = ? WHERE id = ? AND user_id = ?"
    ).bind(error.code || "AGENT_WORKFLOW_FAILED", finishedAt, finishedAt, taskId, userId).run();
    throw error;
  }
}
