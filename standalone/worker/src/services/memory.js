const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "for", "from", "have", "into",
  "just", "more", "please", "that", "the", "their", "them", "then", "there",
  "this", "with", "would", "your", "you", "what", "when", "where", "which"
]);

function tokens(value) {
  return String(value || "").toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

export function scoreMemory(memoryContent, query) {
  const memoryTokens = new Set(tokens(memoryContent));
  const queryTokens = new Set(tokens(query));
  if (!memoryTokens.size || !queryTokens.size) return 0;
  let overlap = 0;
  for (const token of queryTokens) if (memoryTokens.has(token)) overlap += 1;
  return overlap / Math.max(1, queryTokens.size);
}

export async function retrieveRelevantMemories(db, userId, query, limit = 5) {
  const result = await db.prepare(
    "SELECT id, kind, content, updated_at FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100"
  ).bind(userId).all();
  return (result.results || [])
    .map((memory) => ({ ...memory, score: scoreMemory(memory.content, query) }))
    .filter((memory) => memory.score > 0)
    .sort((a, b) => b.score - a.score || String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, Math.max(1, Math.min(10, limit)))
    .map(({ id, kind, content, updated_at, score }) => ({ id, kind, content, updated_at, score }));
}

export async function saveExplicitMemory(db, userId, kind, content) {
  if (!["preference", "fact", "goal", "instruction"].includes(kind)) {
    const error = new Error("Unsupported memory type.");
    error.code = "INVALID_MEMORY_KIND";
    throw error;
  }
  const cleanContent = String(content || "").trim();
  if (!cleanContent || cleanContent.length > 2000) {
    const error = new Error("Memory must be between 1 and 2,000 characters.");
    error.code = "INVALID_MEMORY_CONTENT";
    throw error;
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO memories (id, user_id, kind, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, 'user_explicit', ?, ?)"
  ).bind(id, userId, kind, cleanContent, now, now).run();
  return { id, kind, content: cleanContent, created_at: now, updated_at: now };
}
