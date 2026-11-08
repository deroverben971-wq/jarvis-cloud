export type AgentStatus = {
  agent: string;
  status: string;
  runId?: string;
  matches?: number;
  errorCode?: string;
};

export type ApiUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

export type ApiSession = {
  token: string;
  expiresAt: string;
  user: ApiUser;
};

export type ApiTask = {
  id: string;
  goal: string;
  status: string;
  assigned_agent: string;
  result_json?: string | null;
  error_code?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
};

export type ApiMemory = {
  id: string;
  kind: "preference" | "fact" | "goal" | "instruction";
  content: string;
  source: string;
  created_at: string;
  updated_at: string;
};

export type ChatResponse = {
  ok: true;
  conversationId: string;
  taskId: string;
  reply: string;
  taskStatus: string;
  agents: AgentStatus[];
};

export type ApiEnvelope<T> = { ok: true } & T;

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function normalizeApiBase(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const base = normalizeApiBase(baseUrl);
  if (!base) throw new ApiError(0, "BACKEND_URL_NOT_SET");
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", "Bearer " + token);

  let response: Response;
  try {
    response = await fetch(base + path, { ...options, headers });
  } catch {
    throw new ApiError(0, "BACKEND_UNREACHABLE");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, typeof payload.error === "string" ? payload.error : "REQUEST_FAILED");
  }
  return payload as T;
}

export function friendlyError(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "UNKNOWN_ERROR";
  const messages: Record<string, string> = {
    BACKEND_URL_NOT_SET: "Add your JARVIS backend URL in Settings to connect.",
    BACKEND_UNREACHABLE: "JARVIS could not reach the backend. Check the URL and connection.",
    UNAUTHORIZED: "Your session expired. Sign in again.",
    REGISTRATION_DISABLED: "Account registration is not configured on the backend yet.",
    INVALID_INVITE_CODE: "That invitation code was not accepted.",
    INVALID_CREDENTIALS: "Email or password is incorrect.",
    LOGIN_RATE_LIMITED: "Too many sign-in attempts. Try again later.",
    DAILY_AI_BUDGET_EXHAUSTED: "JARVIS reached its configured free AI-call limit. No paid fallback is enabled.",
    AI_UNAVAILABLE: "The free AI service is currently unavailable.",
    MESSAGE_LENGTH_INVALID: "Your message is empty or too long.",
    AUDIO_TOO_LARGE: "That recording is too large. Record a shorter voice message.",
    AUDIO_DURATION_INVALID: "Voice recordings must be 1 to 60 seconds long.",
    AUDIO_SIZE_INVALID: "No usable audio was received. Try recording again.",
    VOICE_DAILY_LIMIT_REACHED: "JARVIS reached its daily free transcription limit. Try again after the daily reset.",
    VOICE_TRANSCRIPTION_FAILED: "JARVIS could not transcribe that recording. Try again or type your message.",
    VOICE_TRANSCRIPT_EMPTY: "No speech was detected. Try again in a quieter place.",
    CONVERSATION_NOT_FOUND: "That conversation could not be found.",
    APPROVAL_INPUT_INVALID: "Add a clear summary and description, and check the request details.",
    APPROVAL_ACTION_TYPE_NOT_ALLOWED: "That action type is not supported by the approval center.",
    APPROVAL_DETAILS_TOO_LARGE: "The approval details are too large. Shorten the request.",
    APPROVAL_ALREADY_RESOLVED: "This approval request has already been decided.",
    APPROVAL_NOT_FOUND: "That approval request could not be found.",
    TASK_NOT_FOUND: "The linked task could not be found in this account."
  };
  if (error instanceof ApiError && error.status >= 500 && !messages[code]) {
    return "A backend service is unavailable. No paid fallback is enabled.";
  }
  return messages[code] || (error instanceof Error ? error.message : "Something went wrong.");
}


export async function transcribeAudio(
  baseUrl: string,
  audio: Blob,
  durationSeconds: number,
  token: string
): Promise<string> {
  const base = normalizeApiBase(baseUrl);
  if (!base) throw new ApiError(0, "BACKEND_URL_NOT_SET");

  let response: Response;
  try {
    response = await fetch(base + "/v1/voice/transcribe", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": audio.type || "application/octet-stream",
        "X-Audio-Duration": String(durationSeconds)
      },
      body: audio
    });
  } catch {
    throw new ApiError(0, "BACKEND_UNREACHABLE");
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload.error === "string" ? payload.error : "VOICE_TRANSCRIPTION_FAILED"
    );
  }

  const transcript = typeof payload.transcript === "string" ? payload.transcript.trim() : "";
  if (!transcript) throw new ApiError(422, "VOICE_TRANSCRIPT_EMPTY");
  return transcript;
}


export type ApiConversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ApiConversationMessage = {
  id: string;
  role: "user" | "assistant" | "agent" | "system";
  agent_name?: string | null;
  content: string;
  created_at: string;
};


export type ApiReminder = {
  id: string;
  title: string;
  body: string;
  run_at: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ApiNotification = {
  id: string;
  scheduled_job_id?: string | null;
  title: string;
  body: string;
  created_at: string;
  read_at?: string | null;
};

export type ApiApproval = {
  id: string;
  task_id?: string | null;
  action_type: string;
  summary: string;
  description: string;
  target: string;
  details: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired";
  created_at: string;
  resolved_at?: string | null;
};
