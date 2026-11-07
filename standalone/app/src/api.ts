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
    CONVERSATION_NOT_FOUND: "That conversation could not be found."
  };
  if (error instanceof ApiError && error.status >= 500 && !messages[code]) {
    return "A backend service is unavailable. No paid fallback is enabled.";
  }
  return messages[code] || (error instanceof Error ? error.message : "Something went wrong.");
}
