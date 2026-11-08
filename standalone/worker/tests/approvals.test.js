import test from "node:test";
import assert from "node:assert/strict";
import { createApproval, normalizeApprovalInput, resolveApproval } from "../src/services/approvals.js";

const validInput = {
  actionType: "email.send",
  summary: "Send the reviewed project update",
  description: "Send the exact message shown here to the specified recipient.",
  target: "review@example.test",
  details: { subject: "Project update", messagePreview: "The project is on schedule." }
};

function fakeDb({ taskOwner = "user-1", approvalOwner = "user-1", status = "pending" } = {}) {
  const state = { taskOwner, approvalOwner, status, inserted: null, updated: null, queries: [] };
  return {
    state,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              state.queries.push(sql);
              if (sql.includes("FROM tasks")) {
                return values[0] === "task-1" && state.taskOwner === values[1] ? { id: "task-1" } : null;
              }
              if (sql.includes("FROM approvals")) {
                return values[0] === "approval-1" && state.approvalOwner === values[1]
                  ? { id: "approval-1", task_id: null, action_type: "email.send", payload_json: JSON.stringify({ summary: validInput.summary, description: validInput.description, target: validInput.target, details: validInput.details }), status: state.status, created_at: "2026-01-01T00:00:00.000Z", resolved_at: null }
                  : null;
              }
              return null;
            },
            async run() {
              state.queries.push(sql);
              if (sql.includes("INSERT INTO approvals")) {
                state.inserted = values;
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE approvals")) {
                state.updated = values;
                if (state.status === "pending" && values[2] === "approval-1" && values[3] === state.approvalOwner) {
                  state.status = values[0];
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              return { meta: { changes: 0 } };
            },
            async all() { return { results: [] }; }
          };
        }
      };
    }
  };
}

test("approval requests allow only known action types and bounded descriptions", () => {
  const normalized = normalizeApprovalInput(validInput);
  assert.equal(normalized.actionType, "email.send");
  assert.throws(() => normalizeApprovalInput({ ...validInput, actionType: "unknown.execute" }), { code: "APPROVAL_ACTION_TYPE_NOT_ALLOWED" });
  assert.throws(() => normalizeApprovalInput({ ...validInput, summary: " " }), { code: "APPROVAL_INPUT_INVALID" });
  assert.throws(() => normalizeApprovalInput({ ...validInput, description: "x".repeat(1201) }), { code: "APPROVAL_INPUT_INVALID" });
  assert.throws(() => normalizeApprovalInput({ ...validInput, extra: "not allowed" }), { code: "APPROVAL_INPUT_INVALID" });
});

test("approval details and task references are bounded and validated", () => {
  assert.throws(() => normalizeApprovalInput({ ...validInput, details: { data: "x".repeat(4100) } }), { code: "APPROVAL_DETAILS_TOO_LARGE" });
  assert.throws(() => normalizeApprovalInput({ ...validInput, taskId: "../other-user-task" }), { code: "APPROVAL_INPUT_INVALID" });
});

test("creating an approval checks that an attached task belongs to the same user", async () => {
  const db = fakeDb({ taskOwner: "user-2" });
  await assert.rejects(() => createApproval(db, "user-1", { ...validInput, taskId: "task-1" }), { code: "TASK_NOT_FOUND" });
  assert.equal(db.state.inserted, null);
});

test("creating a valid approval stores a pending request only", async () => {
  const db = fakeDb();
  const approval = await createApproval(db, "user-1", { ...validInput, taskId: "task-1" });
  assert.equal(approval.status, "pending");
  assert.equal(approval.action_type, "email.send");
  assert.equal(approval.summary, validInput.summary);
  assert.ok(db.state.inserted);
  assert.equal(db.state.queries.some(sql => sql.includes("tool_calls")), false);
});

test("decisions are pending-only and do not invoke tools", async () => {
  const db = fakeDb();
  const approval = await resolveApproval(db, "user-1", "approval-1", "approve");
  assert.equal(approval.status, "approved");
  assert.equal(db.state.updated[0], "approved");
  assert.match(db.state.queries.find(sql => sql.includes("UPDATE approvals")), /status = 'pending'/);
  assert.equal(db.state.queries.some(sql => sql.includes("tool_calls")), false);
  await assert.rejects(() => resolveApproval(db, "user-1", "approval-1", "reject"), { code: "APPROVAL_ALREADY_RESOLVED" });
});

test("approval decisions cannot access another account's record", async () => {
  const db = fakeDb({ approvalOwner: "user-2" });
  assert.equal(await resolveApproval(db, "user-1", "approval-1", "approve"), null);
});

test("invalid decisions are rejected", async () => {
  await assert.rejects(() => resolveApproval(fakeDb(), "user-1", "approval-1", "execute"), { code: "APPROVAL_DECISION_INVALID" });
});
