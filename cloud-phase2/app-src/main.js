import { VoiceClient } from "agents/voice/client";
import "./style.css";

const API_BASE = "https://jarvis-cloud-phase2.deroverben971.workers.dev";
const SESSION_KEY = "jarvis-app-session-v1";

const el = (id) => document.getElementById(id);
const loginPanel = el("loginPanel");
const assistantPanel = el("assistantPanel");
const pairForm = el("pairForm");
const pairCode = el("pairCode");
const loginMessage = el("loginMessage");
const connectionPill = el("connectionPill");
const statusText = el("statusText");
const interimText = el("interimText");
const orb = el("orb");
const callButton = el("callButton");
const callButtonText = el("callButtonText");
const muteButton = el("muteButton");
const logoutButton = el("logoutButton");
const installButton = el("installButton");
const transcriptList = el("transcriptList");
const messageCount = el("messageCount");
const textForm = el("textForm");
const textInput = el("textInput");
const sendButton = el("sendButton");

let sessionToken = localStorage.getItem(SESSION_KEY) || "";
let voiceClient = null;
let callActive = false;
let muted = false;
let installedPrompt = null;
let transcript = [];

function showLogin(message = "") {
  loginPanel.hidden = false;
  assistantPanel.hidden = true;
  loginMessage.textContent = message;
  pairCode.value = "";
  pairCode.focus();
}

function showAssistant() {
  loginPanel.hidden = true;
  assistantPanel.hidden = false;
}

function setStatus(label, mode = "idle") {
  statusText.textContent = label;
  orb.dataset.state = mode;
  const connected = Boolean(voiceClient);
  connectionPill.textContent = connected ? "CONNECTED" : "OFFLINE";
  connectionPill.dataset.connected = connected ? "true" : "false";
}

function renderTranscript(messages) {
  transcript = Array.isArray(messages) ? messages : [];
  transcriptList.replaceChildren();

  if (!transcript.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Your conversation will appear here.";
    transcriptList.append(empty);
  } else {
    for (const message of transcript.slice(-60)) {
      const role = String(message.role || "assistant");
      const item = document.createElement("article");
      item.className = "message " + (role === "user" ? "user-message" : "assistant-message");
      const speaker = document.createElement("span");
      speaker.className = "message-speaker";
      speaker.textContent = role === "user" ? "YOU" : "JARVIS";
      const body = document.createElement("p");
      body.textContent = String(message.text || message.content || "");
      item.append(speaker, body);
      transcriptList.append(item);
    }
    transcriptList.scrollTop = transcriptList.scrollHeight;
  }
  messageCount.textContent = transcript.length + (transcript.length === 1 ? " message" : " messages");
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("Content-Type", "application/json");
  if (sessionToken && path !== "/app/api/pair") {
    headers.set("Authorization", "Bearer " + sessionToken);
  }
  const response = await fetch(API_BASE + path, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "JARVIS could not complete that request.");
  }
  return body;
}

function cleanUpVoice() {
  if (voiceClient) {
    try { voiceClient.endCall(); } catch {}
    try { voiceClient.disconnect(); } catch {}
  }
  voiceClient = null;
  callActive = false;
  muted = false;
  muteButton.disabled = true;
  muteButton.textContent = "Ⅱ";
  muteButton.setAttribute("aria-label", "Mute microphone");
  callButtonText.textContent = "Start conversation";
  callButton.classList.remove("active");
  interimText.textContent = "Start a conversation when you're ready.";
  setStatus("JARVIS is ready", "idle");
}

function connectVoice() {
  if (voiceClient) return;
  const host = new URL(API_BASE).host;
  voiceClient = new VoiceClient({
    agent: "JarvisVoiceAgent",
    name: "primary",
    host,
    query: { token: sessionToken }
  });

  voiceClient.addEventListener("statuschange", (status) => {
    const value = String(status || "idle").toLowerCase();
    const labels = {
      idle: "JARVIS is ready",
      listening: "Listening",
      thinking: "Thinking",
      speaking: "Speaking"
    };
    setStatus(labels[value] || "JARVIS is " + value, value);
    callActive = value !== "idle";
    callButtonText.textContent = callActive ? "End conversation" : "Start conversation";
    callButton.classList.toggle("active", callActive);
    muteButton.disabled = !callActive;
  });

  voiceClient.addEventListener("transcriptchange", renderTranscript);
  voiceClient.addEventListener("interimtranscript", (text) => {
    interimText.textContent = text ? String(text) : " ";
  });
  voiceClient.addEventListener("connectionchange", (connected) => {
    connectionPill.textContent = connected ? "CONNECTED" : "RECONNECTING";
    connectionPill.dataset.connected = connected ? "true" : "false";
    if (!connected) setStatus("Reconnecting to JARVIS…", "thinking");
  });
  voiceClient.addEventListener("mutechange", (value) => {
    muted = Boolean(value);
    muteButton.textContent = muted ? "●" : "Ⅱ";
    muteButton.setAttribute("aria-label", muted ? "Unmute microphone" : "Mute microphone");
  });
  voiceClient.addEventListener("audiolevelchange", (level) => {
    orb.style.setProperty("--audio-level", String(Math.max(0, Math.min(1, Number(level) || 0))));
  });
  voiceClient.addEventListener("error", (error) => {
    const message = typeof error === "string" ? error : error?.message || "Voice connection error.";
    setStatus(message, "error");
  });

  try {
    voiceClient.connect();
    connectionPill.textContent = "CONNECTING";
    connectionPill.dataset.connected = "false";
  } catch (error) {
    cleanUpVoice();
    setStatus(error?.message || "Could not connect", "error");
  }
}

async function enterApp(token) {
  sessionToken = token;
  localStorage.setItem(SESSION_KEY, token);
  await api("/app/api/session");
  showAssistant();
  connectVoice();
}

pairForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = pairCode.value.trim().toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{12}$/.test(code)) {
    loginMessage.textContent = "Enter the 12-character code JARVIS sent you.";
    return;
  }
  const button = pairForm.querySelector("button");
  button.disabled = true;
  loginMessage.textContent = "Connecting securely…";
  try {
    const result = await api("/app/api/pair", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    await enterApp(result.token);
  } catch (error) {
    sessionToken = "";
    localStorage.removeItem(SESSION_KEY);
    loginMessage.textContent = error?.message || "Pairing failed.";
  } finally {
    button.disabled = false;
  }
});

callButton.addEventListener("click", async () => {
  if (!voiceClient) {
    setStatus("Reconnect to JARVIS to start", "error");
    return;
  }
  if (callActive) {
    voiceClient.endCall();
    return;
  }
  callButton.disabled = true;
  try {
    setStatus("Requesting microphone access…", "thinking");
    await voiceClient.startCall();
    callActive = true;
  } catch (error) {
    setStatus(error?.message || "Microphone access was not granted", "error");
  } finally {
    callButton.disabled = false;
  }
});

muteButton.addEventListener("click", () => {
  if (!voiceClient || !callActive) return;
  voiceClient.toggleMute();
});

textInput.addEventListener("input", () => {
  sendButton.disabled = !textInput.value.trim();
});

textForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = textInput.value.trim();
  if (!message || !voiceClient) return;
  voiceClient.sendText(message);
  textInput.value = "";
  sendButton.disabled = true;
});

logoutButton.addEventListener("click", async () => {
  cleanUpVoice();
  try {
    await api("/app/api/session", { method: "DELETE" });
  } catch {}
  localStorage.removeItem(SESSION_KEY);
  sessionToken = "";
  showLogin("You have signed out of JARVIS.");
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installedPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener("click", async () => {
  if (!installedPrompt) return;
  installedPrompt.prompt();
  await installedPrompt.userChoice.catch(() => null);
  installedPrompt = null;
  installButton.hidden = true;
});
window.addEventListener("appinstalled", () => {
  installButton.hidden = true;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

async function boot() {
  if (!sessionToken) {
    showLogin();
    return;
  }
  try {
    await enterApp(sessionToken);
  } catch {
    localStorage.removeItem(SESSION_KEY);
    sessionToken = "";
    showLogin("Your session expired. Pair this device again.");
  }
}

boot();
