(() => {
  const $ = (id) => document.getElementById(id);
  const orb = $("orb"), stateLabel = $("state-label"), micButton = $("mic-button");
  const messages = $("messages"), input = $("text-input"), sendButton = $("send-button");
  const accessKeyInput = $("access-key"), voiceSelect = $("voice-select");
  const connection = $("connection"), stopSpeaking = $("stop-speaking");
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, listening = false, busy = false, voices = [];

  const savedKey = localStorage.getItem("jarvis_app_key") || "";
  if (savedKey) accessKeyInput.value = savedKey;

  function setState(state, label) {
    orb.className = "orb" + (state ? " " + state : "");
    stateLabel.textContent = label;
    micButton.classList.toggle("active", state === "listening");
    micButton.setAttribute("aria-label", state === "listening" ? "Stop listening" : "Start voice input");
  }
  function addMessage(who, text) {
    const wrap = document.createElement("div");
    wrap.className = "message " + who;
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = who === "assistant" ? "J" : "YOU";
    const body = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = who === "assistant" ? "JARVIS" : "YOU";
    const p = document.createElement("p");
    p.textContent = text;
    body.append(name, p); wrap.append(avatar, body); messages.append(wrap);
    messages.scrollTop = messages.scrollHeight;
    return p;
  }
  function getKey() { return localStorage.getItem("jarvis_app_key") || sessionStorage.getItem("jarvis_app_key") || ""; }

  function loadVoices() {
    voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    const previous = voiceSelect.value;
    voiceSelect.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = ""; defaultOption.textContent = "Default English voice";
    voiceSelect.append(defaultOption);
    const enVoices = voices.filter(v => /^en(-|_)/i.test(v.lang));
    const preferredNames = /david|daniel|james|mark|guy|alex|fred|tom|aaron|michael|richard|john|male/i;
    const ordered = [...enVoices.filter(v => preferredNames.test(v.name)), ...enVoices.filter(v => !preferredNames.test(v.name))];
    const seen = new Set();
    ordered.forEach(v => {
      if (seen.has(v.name + v.lang)) return;
      seen.add(v.name + v.lang);
      const option = document.createElement("option");
      option.value = String(voices.indexOf(v));
      option.textContent = v.name + " — " + v.lang;
      voiceSelect.append(option);
    });
    if ([...voiceSelect.options].some(o => o.value === previous)) voiceSelect.value = previous;
    else if (voiceSelect.options.length > 1) voiceSelect.selectedIndex = 1;
  }
  if ("speechSynthesis" in window) {
    loadVoices();
    speechSynthesis.addEventListener("voiceschanged", loadVoices);
  }

  function speak(text) {
    if (!("speechSynthesis" in window) || !$("auto-speak").checked) {
      setState("", "Tap the microphone to continue");
      return;
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const idx = voiceSelect.value;
    if (idx !== "" && voices[Number(idx)]) utterance.voice = voices[Number(idx)];
    else {
      const maleLike = voices.find(v => /^en/i.test(v.lang) && /david|daniel|james|mark|guy|alex|fred|tom|aaron|michael|richard|john|male/i.test(v.name));
      if (maleLike) utterance.voice = maleLike;
    }
    utterance.lang = utterance.voice?.lang || "en-US";
    utterance.rate = 0.96;
    utterance.pitch = 0.88;
    utterance.onstart = () => { setState("speaking", "JARVIS is speaking"); stopSpeaking.hidden = false; };
    utterance.onend = () => { stopSpeaking.hidden = true; setState("", "Tap the microphone to continue"); };
    utterance.onerror = () => { stopSpeaking.hidden = true; setState("", "Reply received · speech playback unavailable"); };
    speechSynthesis.speak(utterance);
  }

  async function sendMessage(text) {
    const clean = String(text || "").trim();
    if (!clean || busy) return;
    const key = getKey();
    if (!key) {
      setState("", "Add your app access key in settings first");
      $("settings").open = true;
      accessKeyInput.focus();
      return;
    }
    addMessage("user", clean);
    input.value = "";
    busy = true; sendButton.disabled = true; micButton.disabled = true;
    setState("thinking", "JARVIS is thinking…");
    connection.textContent = "Cloud · connecting";
    try {
      const response = await fetch("/app/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
        body: JSON.stringify({ message: clean })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
      addMessage("assistant", data.reply);
      connection.textContent = "Cloud · connected";
      speak(data.reply);
    } catch (error) {
      addMessage("assistant", "I couldn't connect to JARVIS Cloud. " + (error.message || "Please check your connection and app key."));
      connection.textContent = "Cloud · connection issue";
      setState("", "Check your connection or app access key");
    } finally {
      busy = false; sendButton.disabled = false; micButton.disabled = false;
    }
  }

  function stopListening() {
    if (recognition && listening) {
      try { recognition.stop(); } catch {}
    }
    listening = false;
    micButton.classList.remove("active");
  }
  function startListening() {
    if (!SpeechRecognition) {
      setState("", "Voice input isn't supported here. Type below or use Chrome on Android/Windows.");
      return;
    }
    if (busy) return;
    if (!getKey()) {
      setState("", "Add your app access key in settings first");
      $("settings").open = true; accessKeyInput.focus(); return;
    }
    if (listening) { stopListening(); setState("", "Microphone stopped"); return; }
    try {
      recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      let finalTranscript = "";
      recognition.onstart = () => { listening = true; setState("listening", "Listening… speak naturally"); };
      recognition.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscript += text;
          else interim += text;
        }
        stateLabel.textContent = interim ? "Heard: " + interim : "Listening…";
      };
      recognition.onerror = (event) => {
        listening = false;
        const friendly = event.error === "not-allowed" ? "Microphone permission denied. Allow mic access in browser settings." :
          event.error === "no-speech" ? "I didn't hear anything. Tap the microphone and try again." :
          "Voice input error: " + event.error;
        setState("", friendly);
      };
      recognition.onend = () => {
        listening = false; micButton.classList.remove("active");
        const text = finalTranscript.trim();
        if (text) sendMessage(text);
        else if (!busy) setState("", "Tap the microphone to try again");
      };
      recognition.start();
    } catch (error) {
      setState("", "Couldn't start the microphone. Check browser permission.");
    }
  }

  micButton.addEventListener("click", startListening);
  $("chat-form").addEventListener("submit", event => { event.preventDefault(); sendMessage(input.value); });
  stopSpeaking.addEventListener("click", () => { speechSynthesis.cancel(); stopSpeaking.hidden = true; setState("", "Speech stopped"); });
  $("save-key").addEventListener("click", () => {
    const key = accessKeyInput.value.trim();
    if (!key) { setState("", "Paste your app access key first"); return; }
    localStorage.setItem("jarvis_app_key", key);
    sessionStorage.removeItem("jarvis_app_key");
    connection.textContent = "Cloud · key saved";
    setState("", "App key saved on this device");
  });
  $("forget-key").addEventListener("click", () => {
    localStorage.removeItem("jarvis_app_key"); sessionStorage.removeItem("jarvis_app_key");
    accessKeyInput.value = ""; connection.textContent = "Cloud · key removed";
    setState("", "App key removed from this browser");
  });
  $("clear-chat").addEventListener("click", () => {
    messages.innerHTML = "";
    addMessage("assistant", "Conversation display cleared. JARVIS's cloud history is unchanged.");
  });
  if (!SpeechRecognition) micButton.title = "Speech recognition is not available in this browser.";
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
})();