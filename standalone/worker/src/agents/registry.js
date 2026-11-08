export const AGENTS = Object.freeze({
  core: { id: "core", name: "JARVIS Core", mode: "orchestrator", enabled: true, description: "Owns the user conversation and overall goal." },
  coordinator: { id: "coordinator", name: "Coordinator", mode: "orchestrator", enabled: true, description: "Dispatches work, manages dependencies, and combines agent results." },
  planner: { id: "planner", name: "Planner", mode: "llm", enabled: true, description: "Breaks the request into bounded subtasks." },
  researcher: { id: "researcher", name: "Researcher", mode: "llm", enabled: true, description: "Extracts evidence and unknowns from supplied context; no live web search in this milestone." },
  analyst: { id: "analyst", name: "Analyst", mode: "llm", enabled: true, description: "Evaluates options, assumptions, and tradeoffs." },
  memory: { id: "memory", name: "Memory Agent", mode: "deterministic", enabled: true, description: "Retrieves user-approved memories with account-scoped lexical matching." },
  personal_assistant: { id: "personal_assistant", name: "Personal Assistant", mode: "tool_agent", enabled: false, description: "Calendar, reminders, and routines; enable after approval-gated tools exist." },
  developer: { id: "developer", name: "Developer Agent", mode: "tool_agent", enabled: false, description: "Repository and code tools; no autonomous code changes or deployment." },
  verifier: { id: "verifier", name: "Verifier", mode: "llm", enabled: true, description: "Checks support, uncertainty, and whether completion claims are justified." },
  safety_gate: { id: "safety_gate", name: "Safety and Permission Gate", mode: "policy", enabled: true, description: "Applies permissions and blocks unsupported consequential actions." }
});

export function getAgentDefinition(agentId) {
  return AGENTS[agentId] ?? null;
}

export function getEnabledAgents() {
  return Object.values(AGENTS).filter((agent) => agent.enabled);
}

export function isRunnableLlmAgent(agentId) {
  const agent = getAgentDefinition(agentId);
  return Boolean(agent && agent.enabled && agent.mode === "llm");
}
