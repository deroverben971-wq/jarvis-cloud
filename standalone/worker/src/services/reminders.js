const REMINDER_MIN_LEAD_MS = 30 * 1000;
const REMINDER_MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;
const CLAIM_BATCH_SIZE = 25;
const STALE_CLAIM_MS = 5 * 60 * 1000;

function reminderError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function normalizeReminderInput(body, nowMs = Date.now()) {
  const title = String(body?.title || "").trim();
  const note = String(body?.body || "").trim();
  const runAtInput = String(body?.runAt || "");

  if (!title || title.length > 120) throw reminderError("REMINDER_TITLE_INVALID");
  if (note.length > 500) throw reminderError("REMINDER_BODY_TOO_LONG");

  // Require an explicit timezone so a server-local assumption can never shift a reminder.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(runAtInput)) {
    throw reminderError("REMINDER_TIME_INVALID");
  }

  const runAtMs = Date.parse(runAtInput);
  if (!Number.isFinite(runAtMs)) throw reminderError("REMINDER_TIME_INVALID");
  if (runAtMs < nowMs + REMINDER_MIN_LEAD_MS) throw reminderError("REMINDER_MUST_BE_IN_FUTURE");
  if (runAtMs > nowMs + REMINDER_MAX_LEAD_MS) throw reminderError("REMINDER_TOO_FAR_AHEAD");

  return {
    title,
    body: note,
    runAt: new Date(runAtMs).toISOString()
  };
}

export async function processDueReminders(env, now = new Date()) {
  if (!env?.DB) return 0;

  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();

  // Recover jobs left in the claimed state if a prior Cron execution stopped midway.
  await env.DB.prepare(
    "UPDATE scheduled_jobs SET status = 'scheduled', updated_at = ? " +
    "WHERE status = 'running' AND updated_at < ?"
  ).bind(nowIso, staleBefore).run();

  const claimed = await env.DB.prepare(
    "UPDATE scheduled_jobs SET status = 'running', updated_at = ? " +
    "WHERE id IN (SELECT id FROM scheduled_jobs WHERE status = 'scheduled' AND run_at <= ? " +
    "ORDER BY run_at ASC LIMIT ?) AND status = 'scheduled' " +
    "RETURNING id, user_id, job_type, payload_json, run_at"
  ).bind(nowIso, nowIso, CLAIM_BATCH_SIZE).all();

  const jobs = claimed.results || [];
  let processed = 0;

  for (const job of jobs) {
    try {
      if (job.job_type !== "reminder") throw reminderError("UNSUPPORTED_SCHEDULED_JOB_TYPE");
      const payload = JSON.parse(job.payload_json || "{}");
      const title = String(payload.title || "Reminder").trim().slice(0, 120) || "Reminder";
      const body = String(payload.body || "").trim().slice(0, 500);

      // The unique scheduled_job_id makes notification creation idempotent across retries.
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO notifications (id, user_id, scheduled_job_id, title, body, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(scheduled_job_id) DO NOTHING"
        ).bind(crypto.randomUUID(), job.user_id, job.id, title, body, nowIso),
        env.DB.prepare(
          "UPDATE scheduled_jobs SET status = 'completed', last_run_at = ?, updated_at = ? " +
          "WHERE id = ? AND status = 'running'"
        ).bind(nowIso, nowIso, job.id)
      ]);
      processed += 1;
    } catch (error) {
      await env.DB.prepare(
        "UPDATE scheduled_jobs SET status = 'failed', updated_at = ? " +
        "WHERE id = ? AND status = 'running'"
      ).bind(nowIso, job.id).run();
      // Do not log reminder text or user payloads.
      console.error("JARVIS reminder job failed:", error?.code || "REMINDER_JOB_FAILED");
    }
  }

  return processed;
}
