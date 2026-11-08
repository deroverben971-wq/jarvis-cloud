const ALLOWED_ACTION_TYPES = new Set([
  "calendar.create_event", "calendar.update_event", "calendar.delete_event",
  "email.send", "message.send", "file.delete", "deployment.publish", "custom"
]);

function approvalError(code, status = 400) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

function boundedText(value, maxLength, required = false) {
  if (value === undefined || value === null) {
    if (required) throw approvalError("APPROVAL_INPUT_INVALID");
    return "";
  }
  if (typeof value !== "string") throw approvalError("APPROVAL_INPUT_INVALID");
  const result = value.trim();
  if ((required && !result) || result.length > maxLength) throw approvalError("APPROVAL_INPUT_INVALID");
  return result;
}

export function normalizeApprovalInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw approvalError("APPROVAL_INPUT_INVALID");
  const allowedKeys = new Set(["actionType", "summary", "description", "target", "details", "taskId"]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) throw approvalError("APPROVAL_INPUT_INVALID");

  const actionType = boundedText(input.actionType, 64, true);
  if (!ALLOWED_ACTION_TYPES.has(actionType)) throw approvalError("APPROVAL_ACTION_TYPE_NOT_ALLOWED");

  const summary = boundedText(input.summary, 120, true);
  const description = boundedText(input.description, 1200, true);
  const target = boundedText(input.target, 200);

  let details = {};
  if (input.details !== undefined && input.details !== null) {
    if (typeof input.details !== "object" || Array.isArray(input.details)) throw approvalError("APPROVAL_INPUT_INVALID");
    details = input.details;
    let serialized;
    try { serialized = JSON.stringify(details); } catch { throw approvalError("APPROVAL_INPUT_INVALID"); }
    if (!serialized || serialized.length > 4000) throw approvalError("APPROVAL_DETAILS_TOO_LARGE");
  }

  let taskId = null;
  if (input.taskId !== undefined && input.taskId !== null && input.taskId !== "") {
    if (typeof input.taskId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(input.taskId)) {
      throw approvalError("APPROVAL_INPUT_INVALID");
    }
    taskId = input.taskId;
  }

  const payload = { summary, description, target, details };
  return { actionType, taskId, payloadJson: JSON.stringify(payload) };
}

function publicApproval(row) {
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json || "{}");
  } catch {
    payload = { summary: "Approval request", description: "Stored request details could not be read.", target: "", details: {} };
  }
  return {
    id: row.id,
    task_id: row.task_id || null,
    action_type: row.action_type,
    summary: String(payload.summary || "Approval request"),
    description: String(payload.description || ""),
    target: String(payload.target || ""),
    details: payload.details && typeof payload.details === "object" && !Array.isArray(payload.details) ? payload.details : {},
    status: row.status,
    created_at: row.created_at,
    resolved_at: row.resolved_at || null
  };
}

export async function listApprovals(db, userId) {
  const result = await db.prepare(
    "SELECT id, task_id, action_type, payload_json, status, created_at, resolved_at " +
    "FROM approvals WHERE user_id = ? ORDER BY CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 100"
  ).bind(userId).all();
  return (result.results || []).map(publicApproval);
}

export async function createApproval(db, userId, input) {
  const normalized = normalizeApprovalInput(input);
  if (normalized.taskId) {
    const task = await db.prepare(
      "SELECT id FROM tasks WHERE id = ? AND user_id = ?"
    ).bind(normalized.taskId, userId).first();
    if (!task) throw approvalError("TASK_NOT_FOUND", 404);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO approvals (id, user_id, task_id, action_type, payload_json, status, created_at, resolved_at) " +
    "VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)"
  ).bind(id, userId, normalized.taskId, normalized.actionType, normalized.payloadJson, now).run();

  return publicApproval({
    id, task_id: normalized.taskId, action_type: normalized.actionType,
    payload_json: normalized.payloadJson, status: "pending", created_at: now, resolved_at: null
  });
}

export async function resolveApproval(db, userId, approvalId, decision) {
  if (decision !== "approve" && decision !== "reject") throw approvalError("APPROVAL_DECISION_INVALID");
  const status = decision === "approve" ? "approved" : "rejected";
  const resolvedAt = new Date().toISOString();
  const result = await db.prepare(
    "UPDATE approvals SET status = ?, resolved_at = ? " +
    "WHERE id = ? AND user_id = ? AND status = 'pending'"
  ).bind(status, resolvedAt, approvalId, userId).run();

  if (!result.meta?.changes) {
    const existing = await db.prepare(
      "SELECT id, task_id, action_type, payload_json, status, created_at, resolved_at " +
      "FROM approvals WHERE id = ? AND user_id = ?"
    ).bind(approvalId, userId).first();
    if (!existing) return null;
    throw approvalError("APPROVAL_ALREADY_RESOLVED", 409);
  }

  const updated = await db.prepare(
    "SELECT id, task_id, action_type, payload_json, status, created_at, resolved_at " +
    "FROM approvals WHERE id = ? AND user_id = ?"
  ).bind(approvalId, userId).first();
  return updated ? publicApproval(updated) : null;
}
