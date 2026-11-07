import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  apiRequest, friendlyError, normalizeApiBase,
  type ApiEnvelope, type ApiMemory, type ApiSession, type ApiTask, type ApiUser,
  type AgentStatus, type ChatResponse
} from "./api";

type Page = "chat" | "tasks" | "agents" | "memory" | "approvals" | "settings";
type ChatMessage = { id: string; role: "user" | "assistant"; content: string; time: string; agents?: AgentStatus[] };
const DEFAULT_API = String(import.meta.env.VITE_JARVIS_API_URL || "");
const AGENTS = [
  ["Planner", "Breaks requests into bounded work"],
  ["Researcher", "Finds evidence and unknowns"],
  ["Analyst", "Evaluates assumptions and tradeoffs"],
  ["Memory", "Retrieves relevant saved context"],
  ["Verifier", "Checks support and completion claims"]
];

function id() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
}
function clock(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function pretty(value: string) {
  return value.replaceAll("_", " ");
}

function AuthScreen({ apiBase, setApiBase, onAuth }: {
  apiBase: string; setApiBase: (value: string) => void; onAuth: (session: ApiSession) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = mode === "login" ? { email, password } : { email, password, displayName, inviteCode };
      const result = await apiRequest<ApiSession & { ok: boolean }>(
        apiBase, mode === "login" ? "/v1/auth/login" : "/v1/auth/register",
        { method: "POST", body: JSON.stringify(body) }
      );
      if (!result.token || !result.user) throw new Error("The backend returned an invalid session.");
      onAuth(result);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-shell">
    <section className="auth-card">
      <div className="brand-lockup"><div className="brand-mark">J</div><div><div className="brand-name">JARVIS</div><div className="brand-subtitle">PERSONAL INTELLIGENCE SYSTEM</div></div></div>
      <div className="eyebrow auth-eyebrow">CLOUD CORE · MULTI-AGENT</div>
      <h1>{mode === "login" ? "Welcome back." : "Create your JARVIS account."}</h1>
      <p className="auth-copy">One assistant. A coordinated team of specialist agents. Your workspace syncs through your private backend.</p>
      <form className="form-stack" onSubmit={submit}>
        {mode === "register" && <label>Display name<input value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={80} placeholder="How JARVIS should address you" /></label>}
        <label>Email<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
        <label>Password<input type="password" required minLength={12} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 12 characters" /></label>
        {mode === "register" && <label>Private invitation code<input required autoComplete="off" value={inviteCode} onChange={e => setInviteCode(e.target.value)} placeholder="Your private invitation code" /></label>}
        <label>Backend URL<input required value={apiBase} onChange={e => setApiBase(e.target.value)} placeholder="https://your-standalone-worker.workers.dev" /></label>
        {error && <div className="error">{error}</div>}
        <button className="primary-button full" type="submit" disabled={busy}>{busy ? "Connecting…" : mode === "login" ? "Sign in to JARVIS" : "Create account"}</button>
      </form>
      <div className="auth-switch">{mode === "login" ? "New to this JARVIS instance?" : "Already have an account?"}<button className="text-button" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create an account" : "Sign in"}</button></div>
      <div className="auth-footnote">STRICTLY FREE · NO AUTOMATIC PAID FALLBACK</div>
    </section>
  </main>;
}

function ChatPage({ messages, busy, backendReady, onSend, onNew }: {
  messages: ChatMessage[]; busy: boolean; backendReady: boolean;
  onSend: (value: string) => Promise<void>; onNew: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = draft.trim();
    if (!value || busy) return;
    setError("");
    setDraft("");
    try { await onSend(value); } catch (cause) { setDraft(value); setError(friendlyError(cause)); }
  }
  return <section className="chat-page">
    <div className="page-head"><div><div className="eyebrow">YOUR ASSISTANT</div><h1>Conversation</h1></div><button className="quiet-button" onClick={onNew} type="button">＋ New chat</button></div>
    <div className="chat-scroll">
      {messages.length === 0 ? <div className="welcome">
        <div className="orb"><span>J</span></div><div className="eyebrow">JARVIS CORE</div>
        <h2>What are we working on?</h2>
        <p>Give JARVIS an outcome, a problem, or an idea. The Coordinator assembles specialist agents and verifies their results.</p>
        <div className="suggestions">{["Help me plan a project from start to finish.", "Compare two options and explain the tradeoffs.", "Break my goals into a realistic weekly plan."].map(item => <button key={item} type="button" onClick={() => setDraft(item)}>{item}<span>↗</span></button>)}</div>
        {!backendReady && <div className="preview-note">Connect the deployed backend in Settings to start a real AI conversation.</div>}
      </div> : <div className="messages">
        {messages.map(message => <article className={"message " + message.role} key={message.id}>
          {message.role === "assistant" && <div className="avatar">J</div>}
          <div className="bubble-wrap"><div className="message-meta">{message.role === "user" ? "YOU" : "JARVIS"} <span>{clock(message.time)}</span></div><div className="bubble">{message.content}</div>
            {message.agents?.length ? <div className="agent-pills">{message.agents.map(agent => <span key={agent.agent} className={agent.status === "completed" ? "done" : ""}>● {pretty(agent.agent)}</span>)}</div> : null}
          </div>
          {message.role === "user" && <div className="avatar user-avatar">Y</div>}
        </article>)}
        {busy && <div className="working"><div className="avatar">J</div><div className="working-card"><span className="pulse" /> JARVIS is coordinating Planner, Researcher, Analyst, and Verifier…</div></div>}
      </div>}
    </div>
    <div className="composer-zone">
      {error && <div className="error">{error}</div>}
      <form className="composer" onSubmit={submit}><textarea rows={1} maxLength={8000} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Tell JARVIS what you want to accomplish…" /><div className="composer-bottom"><span>Enter to send · Multi-agent reasoning</span><button disabled={busy || !draft.trim()} aria-label="Send message">↑</button></div></form>
      <div className="composer-note">External actions remain approval-gated. JARVIS must verify results before claiming completion.</div>
    </div>
  </section>;
}

function TasksPage({ tasks }: { tasks: ApiTask[] }) {
  return <section className="content-page"><div className="page-head"><div><div className="eyebrow">WORKSPACE</div><h1>Tasks & goals</h1></div><span className="count">{tasks.length} recorded</span></div>
    <p className="intro">Multi-step requests are saved as tasks with a status and agent results.</p>
    {!tasks.length ? <div className="empty"><h3>No tasks yet</h3><p>Ask JARVIS to work toward an outcome and the Coordinator will create a task record.</p></div> :
      <div className="stack">{tasks.map(task => <article className="data-card" key={task.id}><div className="data-top"><span className={"status " + task.status}>{pretty(task.status)}</span><time>{clock(task.updated_at)}</time></div><h3>{task.goal}</h3><div className="data-foot"><span>Owner: {task.assigned_agent}</span><code>{task.id.slice(0, 8)}</code></div>{task.error_code && <p className="error-text">{task.error_code}</p>}</article>)}</div>}
  </section>;
}

function AgentsPage({ tasks }: { tasks: ApiTask[] }) {
  const latest = tasks[0];
  const result = useMemo(() => {
    if (!latest?.result_json) return null;
    try { return JSON.parse(latest.result_json) as { contributions?: Array<{agent:string;status:string}>; verifierRunId?: string }; }
    catch { return null; }
  }, [latest]);
  return <section className="content-page"><div className="page-head"><div><div className="eyebrow">MULTI-AGENT SYSTEM</div><h1>Agent activity</h1></div><span className="count">2 parallel specialist slots</span></div>
    <p className="intro">A central Coordinator dispatches independent specialists, then the Verifier checks the combined answer.</p>
    <div className="agent-grid">{AGENTS.map(([name, description], index) => <article className="agent-card" key={name}><span className="agent-number">0{index + 1}</span><div><b>{name}</b><p>{description}</p></div><small>{name === "Memory" ? "LOCAL LOGIC" : "READY"}</small></article>)}</div>
    <div className="subhead"><div className="eyebrow">LATEST EXECUTION</div><h2>{latest ? "Most recent task" : "No execution yet"}</h2></div>
    {!latest ? <div className="empty">Agent results will appear after your first real request.</div> : <article className="data-card"><div className="data-top"><span className={"status " + latest.status}>{pretty(latest.status)}</span><time>{clock(latest.updated_at)}</time></div><h3>{latest.goal}</h3>{result?.contributions?.map(item => <div className="execution" key={item.agent}><b>{item.agent}</b><span>{item.status}</span></div>)}{result?.verifierRunId && <p className="verified">✓ Verifier pass recorded</p>}</article>}
  </section>;
}

function MemoryPage({ memories, onAdd, onDelete }: {
  memories: ApiMemory[]; onAdd: (kind: ApiMemory["kind"], content: string) => Promise<void>; onDelete: (id: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<ApiMemory["kind"]>("preference");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) return;
    setBusy(true); setError("");
    try { await onAdd(kind, content.trim()); setContent(""); } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(false); }
  }
  return <section className="content-page"><div className="page-head"><div><div className="eyebrow">PERSISTENT CONTEXT</div><h1>Memory</h1></div><span className="count">{memories.length} saved</span></div>
    <p className="intro">Only information you explicitly save is stored as long-term memory in this first build. Review or delete it whenever you need.</p>
    <form className="memory-form" onSubmit={submit}><div className="form-row"><select value={kind} onChange={e => setKind(e.target.value as ApiMemory["kind"])}><option value="preference">Preference</option><option value="fact">Important fact</option><option value="goal">Goal</option><option value="instruction">Instruction</option></select><span>USER-APPROVED MEMORY</span></div><textarea rows={3} maxLength={2000} value={content} onChange={e => setContent(e.target.value)} placeholder="Example: I prefer JARVIS to use a male-sounding voice." />{error && <div className="error">{error}</div>}<div className="form-bottom"><span>{content.length}/2000</span><button className="primary-button" disabled={busy || !content.trim()}>{busy ? "Saving…" : "＋ Save memory"}</button></div></form>
    <div className="subhead"><div className="eyebrow">YOUR SAVED CONTEXT</div><h2>Memory library</h2></div>
    {!memories.length ? <div className="empty"><h3>Your memory is empty</h3><p>Add a preference, important fact, goal, or instruction. JARVIS can retrieve relevant entries during a conversation.</p></div> : <div className="stack">{memories.map(memory => <article className="data-card" key={memory.id}><div className="eyebrow">{memory.kind.replaceAll("_", " ")}</div><p>{memory.content}</p><div className="data-foot"><time>{new Date(memory.updated_at).toLocaleDateString()}</time><button className="text-danger" type="button" onClick={() => void onDelete(memory.id)}>Delete</button></div></article>)}</div>}
  </section>;
}

function SettingsPage({ apiBase, onSave, user, onLogout, health }: {
  apiBase: string; onSave: (value: string) => void; user: ApiUser; onLogout: () => void; health: string;
}) {
  const [value, setValue] = useState(apiBase);
  const [saved, setSaved] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); onSave(value); setSaved(true); window.setTimeout(() => setSaved(false), 2000);
  }
  return <section className="content-page"><div className="page-head"><div><div className="eyebrow">CONFIGURATION</div><h1>Settings</h1></div><span className="count">Strictly free</span></div>
    <div className="data-card settings-card"><div className="data-top"><div><div className="eyebrow">CONNECTION</div><h3>JARVIS cloud backend</h3></div><span className={"connection " + health}>{health === "online" ? "● CONNECTED" : health === "offline" ? "● OFFLINE" : "● UNKNOWN"}</span></div><form onSubmit={submit} className="settings-form"><label>Worker API base URL<input value={value} onChange={e => setValue(e.target.value)} placeholder="https://your-standalone-worker.workers.dev" /></label><button className="primary-button">Save backend URL</button>{saved && <span className="verified">Saved on this device.</span>}</form></div>
    <div className="data-card settings-card"><div className="eyebrow">ACCOUNT</div><h3>{user.displayName || "JARVIS user"}</h3><p className="muted">{user.email}</p><button className="danger-button" onClick={onLogout}>Sign out</button></div>
    <div className="data-card settings-card"><div className="eyebrow">BUDGET POLICY</div><h3>Free-only by design</h3><p className="muted">JARVIS stops when its free AI budget is exhausted. It will not silently switch to paid APIs or upgrade an account.</p></div>
    <p className="app-version">JARVIS Standalone · App shell 0.1.0</p>
  </section>;
}

export default function App() {
  const [apiBase, setApiBase] = useState(() => window.localStorage.getItem("jarvis.apiBase") || DEFAULT_API);
  const [token, setToken] = useState(() => window.sessionStorage.getItem("jarvis.session") || "");
  const [user, setUser] = useState<ApiUser | null>(null);
  const [page, setPage] = useState<Page>("chat");
  const [health, setHealth] = useState<"unknown" | "online" | "offline">("unknown");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [memories, setMemories] = useState<ApiMemory[]>([]);
  const [busy, setBusy] = useState(false);
  const [globalError, setGlobalError] = useState("");

  useEffect(() => {
    const base = normalizeApiBase(apiBase);
    if (!base) { setHealth("unknown"); return; }
    let active = true;
    apiRequest<{ok:boolean}>(base, "/health").then(() => { if (active) setHealth("online"); }).catch(() => { if (active) setHealth("offline"); });
    return () => { active = false; };
  }, [apiBase]);

  useEffect(() => {
    if (!token || !apiBase) return;
    let active = true;
    async function load() {
      try {
        const [profile, taskResult, memoryResult] = await Promise.all([
          apiRequest<ApiEnvelope<{user:ApiUser}>>(apiBase, "/v1/me", {}, token),
          apiRequest<ApiEnvelope<{tasks:ApiTask[]}>>(apiBase, "/v1/tasks", {}, token),
          apiRequest<ApiEnvelope<{memories:ApiMemory[]}>>(apiBase, "/v1/memories", {}, token)
        ]);
        if (!active) return;
        setUser(profile.user); setTasks(taskResult.tasks || []); setMemories(memoryResult.memories || []);
      } catch (error) {
        if (!active) return;
        setGlobalError(friendlyError(error));
        if (error instanceof Error && error.message === "UNAUTHORIZED") { window.sessionStorage.removeItem("jarvis.session"); setToken(""); }
      }
    }
    void load();
    return () => { active = false; };
  }, [apiBase, token]);

  function authenticated(session: ApiSession) {
    window.sessionStorage.setItem("jarvis.session", session.token);
    setToken(session.token); setUser(session.user); setGlobalError("");
  }

  function saveApiBase(value: string) {
    const clean = normalizeApiBase(value);
    setApiBase(clean); window.localStorage.setItem("jarvis.apiBase", clean);
  }

  async function refreshData() {
    if (!token) return;
    const [taskResult, memoryResult] = await Promise.all([
      apiRequest<ApiEnvelope<{tasks:ApiTask[]}>>(apiBase, "/v1/tasks", {}, token),
      apiRequest<ApiEnvelope<{memories:ApiMemory[]}>>(apiBase, "/v1/memories", {}, token)
    ]);
    setTasks(taskResult.tasks || []); setMemories(memoryResult.memories || []);
  }

  async function sendMessage(value: string) {
    if (!token) throw new Error("UNAUTHORIZED");
    setBusy(true);
    const userMessage: ChatMessage = { id: id(), role: "user", content: value, time: new Date().toISOString() };
    setMessages(current => [...current, userMessage]);
    try {
      const response = await apiRequest<ChatResponse>(apiBase, "/v1/chat", {
        method: "POST", body: JSON.stringify({ message: value, conversationId: conversationId || undefined })
      }, token);
      setConversationId(response.conversationId);
      setMessages(current => [...current, { id: id(), role: "assistant", content: response.reply, agents: response.agents, time: new Date().toISOString() }]);
      await refreshData();
    } catch (error) {
      setMessages(current => current.filter(item => item.id !== userMessage.id));
      throw error;
    } finally { setBusy(false); }
  }

  async function addMemory(kind: ApiMemory["kind"], content: string) {
    await apiRequest<ApiEnvelope<{memory:ApiMemory}>>(apiBase, "/v1/memories", {
      method: "POST", body: JSON.stringify({kind, content})
    }, token);
    await refreshData();
  }

  async function deleteMemory(memoryId: string) {
    await apiRequest<ApiEnvelope<Record<string,never>>>(apiBase, "/v1/memories/" + encodeURIComponent(memoryId), {method:"DELETE"}, token);
    await refreshData();
  }

  async function logout() {
    try { await apiRequest(apiBase, "/v1/auth/logout", {method:"POST"}, token); } catch { /* local session is still cleared */ }
    window.sessionStorage.removeItem("jarvis.session");
    setToken(""); setUser(null); setMessages([]); setConversationId(""); setTasks([]); setMemories([]);
  }

  if (!token || !user) return <AuthScreen apiBase={apiBase} setApiBase={value => { setApiBase(value); window.localStorage.setItem("jarvis.apiBase", value); }} onAuth={authenticated} />;

  const nav: Array<[Page,string,string]> = [
    ["chat","◉","Conversation"],["tasks","▤","Tasks & goals"],["agents","⌘","Agent activity"],
    ["memory","⌁","Memory"],["approvals","◇","Approvals"]
  ];
  const pageTitle: Record<Page,string> = {chat:"Conversation",tasks:"Tasks & goals",agents:"Agent activity",memory:"Memory",approvals:"Approvals",settings:"Settings"};

  return <div className="app-shell">
    <aside className="sidebar"><div className="sidebar-brand"><div className="brand-mark small">J</div><div><div className="brand-name">JARVIS</div><div className="brand-subtitle">PERSONAL AI</div></div></div>
      <div className="nav-label">WORKSPACE</div><nav>{nav.map(([key,icon,label]) => <button key={key} className={page === key ? "nav-item active" : "nav-item"} onClick={() => setPage(key)}><span>{icon}</span>{label}</button>)}</nav>
      <div className="sidebar-bottom"><button className={page === "settings" ? "nav-item active" : "nav-item"} onClick={() => setPage("settings")}><span>⚙</span>Settings</button><div className="user-mini"><div className="user-avatar">{(user.displayName || user.email).slice(0,1).toUpperCase()}</div><div className="user-details"><b>{user.displayName || "JARVIS user"}</b><span>{user.email}</span></div><button className="logout-icon" onClick={() => void logout()} title="Sign out">↗</button></div></div>
    </aside>
    <main className="main-area"><header className="topbar"><div className="breadcrumb"><b>JARVIS</b><span>/</span>{pageTitle[page]}</div><div className="top-status"><span className={"connection-dot " + health} />{health === "online" ? "Cloud connected" : health === "offline" ? "Backend unavailable" : "Cloud not checked"}<span className="free-badge">FREE CORE</span></div></header>
      {globalError && <div className="global-error">{globalError}<button onClick={() => setGlobalError("")}>Dismiss</button></div>}
      {page === "chat" && <ChatPage messages={messages} busy={busy} backendReady={health === "online"} onSend={sendMessage} onNew={() => {setConversationId("");setMessages([]);}} />}
      {page === "tasks" && <TasksPage tasks={tasks} />}
      {page === "agents" && <AgentsPage tasks={tasks} />}
      {page === "memory" && <MemoryPage memories={memories} onAdd={addMemory} onDelete={deleteMemory} />}
      {page === "approvals" && <section className="content-page"><div className="page-head"><div><div className="eyebrow">PERMISSION CENTER</div><h1>Approvals</h1></div><span className="count">Protected</span></div><div className="approval-banner"><div className="approval-symbol">◇</div><div><h2>Nothing acts without its permission layer.</h2><p>Calendar changes, messages, deployments, and file deletion will require explicit approval before their tools are enabled.</p></div></div><div className="empty"><h3>Approval workflow is not connected yet</h3><p>The database has approval records. The interactive approval API and tool execution layer are a later backend milestone.</p></div></section>}
      {page === "settings" && <SettingsPage apiBase={apiBase} onSave={saveApiBase} user={user} onLogout={() => void logout()} health={health} />}
    </main>
  </div>;
}
