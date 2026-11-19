/* 김치 v1.1 — 앱 로직
   · 대화는 공개 중계 서버(app:"kimchi")를 거쳐 Gemini로 간다. API 키는 클라이언트에 없다.
   · 음성: SpeechRecognition(듣기) + speechSynthesis(읽기). 안 되면 통화 화면의 키보드 입력으로 이어간다.
   · v1.1: 사전 예열(warm)·문맥 축소·통화 짧은 답(call:true)·통화 연결 지연 단축·
           목소리 프리셋/기기 음성 선택·기본 호칭 '드카'·한국어 조사 다듬기 */
(function () {
  "use strict";

  var CFG = window.KIMCHI_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  var DEFAULT_NAME = "드카";

  var state = {
    name: DEFAULT_NAME,
    tone: "formal",     /* formal | casual */
    theme: "light",     /* light | dark */
    speaker: true,
    todos: [],
    messages: [],
    busy: false,
    voice: { preset: "basic", device: "" },
    call: { active: false, muted: false, timer: null, startedAt: 0 }
  };

  /* ---------------- 목소리 프리셋 ---------------- */
  var VOICE_PRESETS = [
    { id: "basic", label: "기본", rate: 1.00, pitch: 1.00 },
    { id: "bright", label: "밝고 빠른", rate: 1.14, pitch: 1.20 },
    { id: "calm", label: "차분한", rate: 0.90, pitch: 0.95 },
    { id: "deep", label: "낮고 묵직한", rate: 0.94, pitch: 0.70 }
  ];

  function presetById(id) {
    for (var i = 0; i < VOICE_PRESETS.length; i++) if (VOICE_PRESETS[i].id === id) return VOICE_PRESETS[i];
    return VOICE_PRESETS[0];
  }

  /* ---------------- 텍스트 ---------------- */
  function hasBatchim(s) {
    var t = String(s || "").trim();
    if (!t) return false;
    var c = t.charAt(t.length - 1), code = c.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 !== 0;
    return false;
  }

  /* 이름 뒤 호격 조사: 받침 있으면 '아', 없으면 '야' */
  function withYa(name) { return name + (hasBatchim(name) ? "아" : "야"); }

  function timePart() {
    var h = new Date().getHours();
    /* 받침에 맞는 서술격 조사: 아침이에요 / 오후예요 / 저녁이에요 */
    if (h < 12) return { part: "좋은 아침", ok: "이에요" };
    if (h < 18) return { part: "좋은 오후", ok: "예요" };
    return { part: "좋은 저녁", ok: "이에요" };
  }

  function ui() {
    var casual = state.tone === "casual";
    var n = state.name;
    var tp = timePart(), part = tp.part, ok = tp.ok;
    return {
      greet: casual
        ? (n ? withYa(n) + ", " + part + "!" : part + "!")
        : (n ? n + "님, " + part + ok + "." : part + ok + "."),
      sub: casual
        ? "오늘 챙길 일부터 내일 일정까지, 편하게 말해."
        : "오늘 챙길 일부터 내일 일정까지, 편하게 말씀하세요.",
      placeholder: casual ? "김치에게 말 걸기" : "김치에게 말하기",
      callGreet: casual ? "여보세요? 김치야. 편하게 말해." : "여보세요, 김치예요. 편하게 말씀하세요.",
      callAsk: casual ? "듣고 있어. 말해 봐." : "듣고 있어요. 말씀하세요.",
      fail: casual
        ? "지금 연결이 잠깐 끊겼어. 한 번만 다시 말해줄래?"
        : "지금 연결이 잠깐 끊겼어요. 한 번만 다시 말씀해 주시겠어요?",
      noMic: "이 브라우저에서는 마이크를 쓸 수 없어요. 아래에 적어서 말해 주세요.",
      noMicCall: "마이크를 쓸 수 없어요. 아래에 적어서 말해 주세요.",
      waiting: casual ? "김치가 생각 중이야…" : "김치가 생각 중이에요…"
    };
  }

  /* ---------------- 테마 / 말투 ---------------- */
  function applyTheme(t) {
    state.theme = t === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", state.theme);
    var meta = $("metaTheme");
    if (meta) meta.setAttribute("content", state.theme === "dark" ? "#0a0a0c" : "#ffffff");
    LS.set("kimchi.theme", state.theme);
  }

  function applyTone(t) {
    state.tone = t === "casual" ? "casual" : "formal";
    document.documentElement.setAttribute("data-tone", state.tone);
    var f = $("toneFormal"), c = $("toneCasual");
    if (f) f.setAttribute("aria-pressed", String(state.tone === "formal"));
    if (c) c.setAttribute("aria-pressed", String(state.tone === "casual"));
    LS.set("kimchi.tone", state.tone);
    renderHome();
    var inp = $("input");
    if (inp) inp.placeholder = ui().placeholder;
    var ci = $("callInput");
    if (ci) ci.placeholder = state.tone === "casual" ? "여기에 적어서 말하기" : "여기에 적어서 말씀하기";
  }

  /* ---------------- 홈 / 칩 ---------------- */
  function renderHome() {
    var u = ui();
    var g = $("greet"), s = $("sub");
    if (g) g.textContent = u.greet;
    if (s) s.textContent = u.sub;
    renderChips();
  }

  function renderChips() {
    var box = $("chips");
    if (!box) return;
    var chips = ["오늘 브리핑해줘", "할 일 정리 도와줘", "오늘 뭐 먹을까", "심심한데 얘기해줘"];
    box.innerHTML = "";
    var mine = document.createElement("button");
    mine.type = "button";
    mine.className = "chip accent";
    mine.textContent = "내 할 일";
    mine.addEventListener("click", function () { openSheet("todo"); });
    box.appendChild(mine);
    chips.forEach(function (label) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = label;
      b.addEventListener("click", function () { warm(); converse(label); });
      box.appendChild(b);
    });
  }

  /* ---------------- 대화 렌더 ---------------- */
  function showChat(on) {
    var home = $("home"), chat = $("chat");
    if (!home || !chat) return;
    home.hidden = on;
    chat.hidden = !on;
  }

  function addToView(role, text) {
    var msgs = $("msgs");
    if (!msgs) return;
    var wrap = document.createElement("div");
    wrap.className = "msg " + (role === "u" ? "me" : "ai");
    if (role === "b") {
      var av = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      av.setAttribute("class", "avatar");
      av.setAttribute("viewBox", "0 0 120 120");
      var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", "#mascot");
      av.appendChild(use);
      wrap.appendChild(av);
    }
    var bub = document.createElement("div");
    bub.className = "bubble";
    bub.textContent = text;
    wrap.appendChild(bub);
    msgs.appendChild(wrap);
    scrollDown();
  }

  function scrollDown() {
    var chat = $("chat");
    if (chat) chat.scrollTop = chat.scrollHeight;
  }

  var typingEl = null;
  function showTyping() {
    if (typingEl) return;
    var msgs = $("msgs");
    if (!msgs) return;
    typingEl = document.createElement("div");
    typingEl.className = "msg ai";
    typingEl.innerHTML = '<div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>';
    msgs.appendChild(typingEl);
    scrollDown();
  }
  function hideTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  function pushMsg(role, text) {
    state.messages.push({ r: role, t: text });
    if (state.messages.length > 80) state.messages = state.messages.slice(-80);
    LS.set("kimchi.messages", state.messages);
  }

  /* ---------------- 대화 흐름 ---------------- */
  /* 문맥은 최근 6메시지·160자까지만 보낸다(통화는 4메시지·100자).
     페이로드가 짧을수록 Apps Script 왕복과 생성 시간이 함께 줄어든다. */
  function historyForApi(callMode) {
    var max = callMode ? (CFG.callHistoryMsgs || 4) : (CFG.historyMsgs || 6);
    var chars = callMode ? (CFG.callHistoryChars || 100) : (CFG.historyChars || 160);
    return state.messages.slice(-max).map(function (m) {
      return { r: m.r, t: String(m.t).slice(0, chars) };
    });
  }

  function situation() {
    var d = new Date();
    var days = ["일", "월", "화", "수", "목", "금", "토"];
    var h = d.getHours(), ampm = h < 12 ? "오전" : "오후", h12 = h % 12 || 12;
    var m = d.getMinutes();
    var out = "지금은 " + d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일 " +
      days[d.getDay()] + "요일 " + ampm + " " + h12 + "시 " + (m < 10 ? "0" + m : m) + "분입니다. (한국 시간)";
    out += "\n사용자 말투 설정: " + (state.tone === "casual" ? "반말" : "존댓말") + ".";
    var open = state.todos.filter(function (t) { return !t.done; }).map(function (t) { return t.text; });
    if (open.length) out += "\n저장된 할 일: " + open.join(", ");
    else out += "\n저장된 할 일: 없음";
    return out;
  }

  function post(body, timeoutMs) {
    var ctrl = null, timer = null;
    var opt = {
      method: "POST",
      /* text/plain 이면 CORS preflight 없이 Apps Script로 바로 간다 */
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
      cache: "no-store"
    };
    try { ctrl = new AbortController(); opt.signal = ctrl.signal; } catch (e) {}
    if (ctrl) timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, timeoutMs || CFG.timeoutMs || 26000);
    return fetch(CFG.proxy, opt)
      .then(function (r) { if (!r.ok) throw new Error("http_" + r.status); return r.text(); })
      .then(function (t) {
        if (timer) clearTimeout(timer);
        var j;
        try { j = JSON.parse(t); } catch (e) { throw new Error("bad_json"); }
        return j;
      })
      .catch(function (e) { if (timer) clearTimeout(timer); throw e; });
  }

  /* ---------------- 사전 예열 (콜드 스타트 제거) ----------------
     중계 서버를 GET으로 한 번 깨워 두면, 사용자가 말을 마치기 전에
     TLS 연결과 Apps Script 인스턴스가 준비된다. 모델은 호출하지 않는다. */
  var warmAt = 0, warmPending = null;

  function warm(force) {
    if (!CFG.proxy) return Promise.resolve(false);
    var ttl = CFG.warmTtlMs || 90000;
    if (!force && warmAt && Date.now() - warmAt < ttl) return Promise.resolve(false);
    if (warmPending) return warmPending;
    warmAt = Date.now();       /* 실패해도 곧 다시 쏘지 않도록 시각은 남긴다 */
    warmPending = Promise.resolve()
      .then(function () { return fetch(CFG.proxy, { cache: "no-store", mode: "cors" }); })
      .then(function (r) { return r.text(); })
      .then(function () { warmPending = null; warmAt = Date.now(); return true; })
      .catch(function () { warmPending = null; return false; });
    return warmPending;
  }

  function ask(text) {
    var onCall = state.call.active;
    var body = {
      action: "chat",
      app: CFG.app || "kimchi",
      tone: state.tone,
      text: text,
      nick: state.name || "",
      ctx: situation(),
      history: historyForApi(onCall),
      model: CFG.model
    };
    if (onCall) body.call = true;      /* 통화 모드: 서버가 1~2문장·140토큰으로 짧게 답한다 */
    return post(body).then(function (j) {
      if (!j || !j.ok || !j.reply) throw new Error((j && j.error) || "empty");
      return String(j.reply).trim();
    }).catch(function (e) {
      /* 한 번만 재시도 — 콜드 스타트/일시 오류 */
      return post(body).then(function (j) {
        if (!j || !j.ok || !j.reply) throw e;
        return String(j.reply).trim();
      });
    });
  }

  function converse(text, opts) {
    opts = opts || {};
    text = String(text || "").trim();
    if (!text) return Promise.resolve();
    if (state.busy) return Promise.resolve();

    state.busy = true;
    hideHome();
    if (!opts.fromCall) { addToView("u", text); pushMsg("u", text); }
    else { pushMsg("u", text); }
    showTyping();
    if (state.call.active) { setCallSub(text, "say"); setWave(true); stopRec(); }

    return ask(text).then(function (reply) {
      hideTyping();
      state.busy = false;
      addToView("b", reply);
      pushMsg("b", reply);
      if (state.call.active) {
        setCallSub(reply, "say");
        speak(reply, function () { if (state.call.active && !state.call.muted) startRec(); });
      } else if (opts.speak) {
        speak(reply);
      }
    }).catch(function () {
      hideTyping();
      state.busy = false;
      var msg = ui().fail;
      addToView("b", msg);
      pushMsg("b", msg);
      if (state.call.active) { setCallSub(msg, "say"); speak(msg, function () { if (state.call.active && !state.call.muted) startRec(); }); }
    });
  }

  function hideHome() {
    if ($("home") && !$("home").hidden) showChat(true);
  }

  /* ---------------- 음성: 목록 / 선택 ---------------- */
  function allVoices() {
    if (!("speechSynthesis" in window) || !window.speechSynthesis) return [];
    var list = [];
    try { list = window.speechSynthesis.getVoices() || []; } catch (e) { list = []; }
    return list;
  }

  function koVoices() {
    var list = allVoices();
    var ko = list.filter(function (v) { return /^ko([-_]|$)/i.test(v.lang || "") || /korean|한국/i.test(v.name || ""); });
    return ko;
  }

  /* 기기 음성: 사용자가 고른 음성 → 없으면 Google → 자연/신경망 → 첫 한국어 */
  function resolveVoice() {
    var ko = koVoices();
    if (!ko.length) return null;
    var want = state.voice.device;
    if (want) {
      for (var i = 0; i < ko.length; i++) {
        if (ko[i].voiceURI === want || ko[i].name === want) return ko[i];
      }
    }
    var pick = null;
    for (var a = 0; a < ko.length; a++) { if (/google/i.test(ko[a].name || "")) { pick = ko[a]; break; } }
    if (!pick) for (var b = 0; b < ko.length; b++) { if (/natural|neural|premium|enhanced/i.test(ko[b].name || "")) { pick = ko[b]; break; } }
    return pick || ko[0] || null;
  }

  function voiceLabel(v) {
    var name = v.name || "기본 음성";
    var local = v.localService ? "기기" : "온라인";
    return name + " · " + local;
  }

  function saveVoice() { LS.set("kimchi.voice", state.voice); }

  function renderVoiceUI() {
    var box = $("voicePresets");
    if (box) {
      box.innerHTML = "";
      VOICE_PRESETS.forEach(function (p) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "voice-chip";
        b.dataset.preset = p.id;
        b.textContent = p.label;
        b.setAttribute("aria-pressed", String(state.voice.preset === p.id));
        b.addEventListener("click", function () {
          state.voice.preset = p.id;
          saveVoice();
          renderVoiceUI();
          previewVoice();
        });
        box.appendChild(b);
      });
    }

    var list = $("voiceList");
    var note = $("voiceNote");
    if (!list) return;
    list.innerHTML = "";
    var ko = koVoices();
    var noteText;
    if (!ko.length) {
      noteText = "이 기기에서 한국어 음성을 찾지 못했어요. 위 스타일(높낮이·속도)은 그대로 적용됩니다.";
    } else {
      noteText = "이 기기의 한국어 음성 " + ko.length + "개 · 기본은 자동으로 가장 좋은 음성을 씁니다.";
    }
    if (note) note.textContent = noteText;

    var auto = document.createElement("button");
    auto.type = "button";
    auto.className = "voice-row";
    auto.dataset.voice = "";
    auto.setAttribute("aria-pressed", String(!state.voice.device));
    auto.innerHTML = '<span class="voice-name">자동 (기기 기본)</span><span class="voice-pick">' +
      (state.voice.device ? "" : "✓") + '</span>';
    auto.addEventListener("click", function () {
      state.voice.device = "";
      saveVoice();
      renderVoiceUI();
      previewVoice();
    });
    list.appendChild(auto);

    ko.forEach(function (v) {
      var key = v.voiceURI || v.name || "";
      var row = document.createElement("button");
      row.type = "button";
      row.className = "voice-row";
      row.dataset.voice = key;
      row.setAttribute("aria-pressed", String(state.voice.device === key));
      var n = document.createElement("span");
      n.className = "voice-name";
      n.textContent = voiceLabel(v);
      var p = document.createElement("span");
      p.className = "voice-pick";
      p.textContent = state.voice.device === key ? "✓" : "";
      row.appendChild(n); row.appendChild(p);
      row.addEventListener("click", function () {
        state.voice.device = key;
        saveVoice();
        renderVoiceUI();
        previewVoice();
      });
      list.appendChild(row);
    });
  }

  /* ---------------- 음성: TTS ---------------- */
  function pickVoice() {
    renderVoiceUI();
  }

  function cleanForSpeech(t) {
    return String(t)
      .replace(/[*_`#>~|]/g, "")
      .replace(/\s*\n+\s*/g, ". ")
      .replace(/\.\s*\./g, ".")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  var speaking = false;

  function speak(text, done, opt) {
    opt = opt || {};
    var finish = function () { speaking = false; setWave(false); if (done) done(); };
    if (!state.speaker || !("speechSynthesis" in window) || !window.speechSynthesis) { finish(); return; }
    var u;
    try {
      u = new SpeechSynthesisUtterance(cleanForSpeech(text));
    } catch (e) { finish(); return; }

    var p = presetById(state.voice.preset);
    var rate = p.rate, pitch = p.pitch;
    if (state.tone === "casual") { rate = Math.min(1.6, rate + 0.03); pitch = Math.min(2, pitch + 0.03); }
    var v = resolveVoice();

    u.lang = "ko-KR";
    u.rate = opt.rate || rate;
    u.pitch = Math.min(2, Math.max(0, opt.pitch || pitch));
    u.volume = 1;
    if (v) u.voice = v;

    var settled = false;
    var once = function () { if (!settled) { settled = true; finish(); } };
    u.onend = once;
    u.onerror = once;
    speaking = true;
    setWave(true);
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { once(); }
    /* 일부 브라우저는 onend를 놓친다 — 길이에 맞춘 안전 타이머 */
    var guard = Math.min(20000, 1400 + cleanForSpeech(text).length * 150);
    setTimeout(function () { if (speaking && settled === false) once(); }, guard);
  }

  function previewVoice() {
    var n = state.name;
    var t = state.tone === "casual"
      ? "안녕" + (n ? ", " + withYa(n) : "") + ". 김치야. 이 목소리로 말할게."
      : (n ? "안녕하세요, " + n + "님. " : "안녕하세요. ") + "김치예요. 이 목소리로 말씀드릴게요.";
    speak(t);
  }

  /* ---------------- 음성: 인식 ---------------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null, recWanted = false, recLive = false;

  function micSupported() { return !!SR; }

  function buildRec() {
    var r = new SR();
    r.lang = "ko-KR";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onstart = function () { recLive = true; setWave(true); };
    r.onresult = function (ev) {
      var fin = "", interim = "";
      for (var i = ev.resultIndex || 0; i < ev.results.length; i++) {
        var res = ev.results[i];
        var t = res[0] && res[0].transcript ? res[0].transcript : "";
        if (res.isFinal) fin += t; else interim += t;
      }
      if (interim) setCallSub(interim, "");
      if (fin && fin.trim()) {
        var said = fin.trim();
        setCallSub(said, "say");
        recWanted = false;
        stopRec();
        converse(said, { fromCall: true });
      }
    };
    r.onerror = function (ev) {
      recLive = false;
      var err = ev && ev.error ? ev.error : "";
      if (err === "not-allowed" || err === "service-not-allowed") {
        recWanted = false;
        callFallback("denied");
      } else if (err === "audio-capture") {
        recWanted = false;
        callFallback("nocapture");
      }
      /* no-speech / aborted / network 은 조용히 넘기고 onend에서 다시 시작 */
      setWave(false);
    };
    r.onend = function () {
      recLive = false;
      setWave(false);
      /* v1.1: 읽기가 끝나면 곧바로 다시 듣는다(대화가 끊기지 않게) */
      if (recWanted && state.call.active && !speaking && !state.call.muted) {
        setTimeout(function () { if (recWanted && state.call.active && !speaking && !state.call.muted) startRec(); }, 0);
      }
    };
    return r;
  }

  function startRec() {
    if (!micSupported() || !state.call.active || state.call.muted) return;
    if (recLive) return;
    if (!rec) rec = buildRec();
    recWanted = true;
    try { rec.start(); } catch (e) {
      /* 아직 종료 처리 중이면 잠깐 뒤 한 번만 더 시도한다 */
      setTimeout(function () {
        if (recWanted && !recLive && state.call.active && !state.call.muted) {
          try { rec.start(); } catch (e2) {}
        }
      }, 120);
    }
  }

  function stopRec() {
    recWanted = false;
    if (rec && recLive) { try { rec.abort(); } catch (e) {} }
  }

  /* ---------------- 통화 화면 ---------------- */
  function setStatus(txt, live) {
    var el = $("callStatus");
    if (!el) return;
    el.textContent = txt;
    el.className = "call-status" + (live ? " live" : "");
  }
  function setTimer(txt) { var el = $("callTimer"); if (el) el.textContent = txt; }
  function fmt(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
  }
  function setWave(on) {
    var w = $("wave");
    if (!w) return;
    w.className = "wave" + (on ? " on" : "");
  }
  function setCallSub(text, cls) {
    var el = $("callSub");
    if (!el) return;
    el.innerHTML = "";
    var span = document.createElement("span");
    span.className = cls || "";
    span.textContent = text;
    el.appendChild(span);
  }

  function callFallback(reason) {
    var fb = $("callFallback");
    if (!fb) return;
    fb.hidden = false;
    var note = $("fallbackNote");
    if (note) note.textContent = reason === "denied"
      ? "마이크 권한이 꺼져 있어요. 주소창의 마이크 권한을 켜거나, 아래에 적어서 말해 주세요."
      : reason === "unsupported"
        ? "이 브라우저는 음성 인식을 지원하지 않아요. 아래에 적어서 말해 주세요."
        : ui().noMicCall;
    var ci = $("callInput");
    if (ci) { try { ci.focus(); } catch (e) {} }
  }

  function startCall() {
    if (state.call.active) return;
    state.call.active = true;
    state.call.muted = false;
    state.call.startedAt = 0;
    state.speaker = true;
    var c = $("call");
    if (c) { c.hidden = false; c.setAttribute("aria-hidden", "false"); }
    document.body.style.overflow = "hidden";
    var fb = $("callFallback"); if (fb) fb.hidden = true;
    var kb = $("kbBtn"); if (kb) kb.setAttribute("aria-pressed", "false");
    var mic = $("micBtn"); if (mic) mic.setAttribute("aria-pressed", "false");
    var spk = $("spkBtn"); if (spk) spk.setAttribute("aria-pressed", "true");
    setStatus("연결 중…", false);
    setTimer("00:00");
    setCallSub("");
    setWave(false);
    warm(true);        /* 통화 중 첫 질문 전에 중계 서버를 미리 깨워 둔다 */

    /* v1.1: 인위적 대기 0.85초 → 0.26초. 첫 인사는 바로 읽는다. */
    setTimeout(function () {
      if (!state.call.active) return;
      setStatus("통화 중", true);
      state.call.startedAt = Date.now();
      if (state.call.timer) clearInterval(state.call.timer);
      state.call.timer = setInterval(function () {
        if (!state.call.active) return;
        setTimer(fmt(Date.now() - state.call.startedAt));
      }, 500);

      var g = ui().callGreet;
      setCallSub(g, "say");
      speak(g, function () {
        if (!state.call.active) return;
        if (!micSupported()) { callFallback("unsupported"); return; }
        startRec();
      });
    }, 260);
  }

  function endCall() {
    if (!state.call.active) { return; }
    state.call.active = false;
    recWanted = false;
    stopRec();
    if (state.call.timer) { clearInterval(state.call.timer); state.call.timer = null; }
    if ("speechSynthesis" in window && window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    speaking = false;
    setWave(false);
    var c = $("call");
    if (c) { c.hidden = true; c.setAttribute("aria-hidden", "true"); }
    document.body.style.overflow = "";
    setStatus("연결 중…", false);
    setTimer("00:00");
    setCallSub("");
  }

  /* ---------------- 할 일 ---------------- */
  function loadTodos() {
    var t = LS.get("kimchi.todos", []);
    state.todos = Array.isArray(t) ? t.filter(function (x) { return x && x.text; }) : [];
  }
  function saveTodos() { LS.set("kimchi.todos", state.todos); renderTodos(); }

  function renderTodos() {
    var ul = $("todoList"), empty = $("todoEmpty");
    if (!ul) return;
    ul.innerHTML = "";
    state.todos.forEach(function (t) {
      var li = document.createElement("li");
      if (t.done) li.className = "done";
      var box = document.createElement("button");
      box.type = "button"; box.className = "box"; box.setAttribute("aria-label", "완료 표시");
      box.addEventListener("click", function () { t.done = !t.done; saveTodos(); });
      var txt = document.createElement("button");
      txt.type = "button"; txt.className = "txt"; txt.textContent = t.text;
      txt.addEventListener("click", function () { t.done = !t.done; saveTodos(); });
      var del = document.createElement("button");
      del.type = "button"; del.className = "del"; del.textContent = "×"; del.setAttribute("aria-label", "삭제");
      del.addEventListener("click", function () {
        state.todos = state.todos.filter(function (x) { return x !== t; });
        saveTodos();
      });
      li.appendChild(box); li.appendChild(txt); li.appendChild(del);
      ul.appendChild(li);
    });
    if (empty) empty.hidden = state.todos.length > 0;
  }

  function addTodo(text) {
    text = String(text || "").trim();
    if (!text) return;
    state.todos.push({ id: Date.now() + Math.random().toString(16).slice(2, 6), text: text, done: false });
    saveTodos();
  }

  /* ---------------- 시트 ---------------- */
  function openSheet(focus) {
    var s = $("sheet");
    if (!s) return;
    $("nameInput").value = state.name || "";
    renderVoiceUI();
    s.hidden = false;
    document.body.style.overflow = "hidden";
    if (focus === "todo") {
      renderTodos();
      var ti = $("todoInput");
      if (ti) setTimeout(function () { try { ti.focus(); } catch (e) {} }, 260);
    }
  }
  function closeSheet() {
    var s = $("sheet");
    if (!s) return;
    s.hidden = true;
    if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    speaking = false; setWave(false);
    if (!state.call.active) document.body.style.overflow = "";
  }

  /* ---------------- 토스트 ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
    var sheetOpen = $("sheet") && !$("sheet").hidden;
    t.className = "toast" + (sheetOpen ? " top" : "");
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------------- 설치 / PWA ---------------- */
  var deferredPrompt = null;

  function isStandalone() {
    try {
      return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
        window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  function showInstall(on) {
    var bar = $("installBar"), btn = $("sheetInstall"), help = $("installHelp");
    if (bar) bar.hidden = !on || isStandalone() || LS.get("kimchi.installOff", false);
    if (btn) btn.hidden = !on;
    if (help) help.hidden = !!on;
  }

  /* ---------------- 초기화 ---------------- */
  function init() {
    /* 테마 */
    var savedTheme = LS.get("kimchi.theme", null);
    var prefersDark = false;
    try { prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) {}
    applyTheme(savedTheme || (prefersDark ? "dark" : "light"));

    /* 말투 */
    applyTone(LS.get("kimchi.tone", "formal"));

    /* 이름 — 처음 열면 '드카', 사용자가 비우면 비운 채로 둔다 */
    var savedName = LS.get("kimchi.name", null);
    state.name = savedName === null ? DEFAULT_NAME : String(savedName || "").slice(0, 12);

    /* 목소리 */
    var sv = LS.get("kimchi.voice", null);
    if (sv && typeof sv === "object") {
      state.voice.preset = presetById(sv.preset).id;
      state.voice.device = String(sv.device || "");
    }

    /* 할 일 / 대화 복원 */
    loadTodos();
    renderTodos();
    var msgs = LS.get("kimchi.messages", []);
    if (Array.isArray(msgs) && msgs.length) {
      state.messages = msgs.slice(-80);
      showChat(true);
      state.messages.forEach(function (m) { if (m && m.t) addToView(m.r === "u" ? "u" : "b", m.t); });
    }
    setWave(false);

    /* 버튼 */
    $("toneFormal").addEventListener("click", function () { applyTone("formal"); });
    $("toneCasual").addEventListener("click", function () { applyTone("casual"); });
    $("themeBtn").addEventListener("click", function () { applyTheme(state.theme === "dark" ? "light" : "dark"); });
    $("settingsBtn").addEventListener("click", function () { openSheet(); });
    $("callBtn").addEventListener("click", function () { warm(true); startCall(); });
    $("endBtn").addEventListener("click", endCall);
    $("micBtn").addEventListener("click", function () {
      state.call.muted = !state.call.muted;
      this.setAttribute("aria-pressed", String(state.call.muted));
      $("micLabel").textContent = state.call.muted ? "마이크 켜기" : "음소거";
      if (state.call.muted) { stopRec(); setWave(false); setCallSub("마이크를 껐어요.", ""); }
      else { setCallSub(ui().callAsk, ""); startRec(); }
    });
    $("spkBtn").addEventListener("click", function () {
      state.speaker = !state.speaker;
      this.setAttribute("aria-pressed", String(state.speaker));
      $("spkLabel").textContent = state.speaker ? "스피커" : "소리 끔";
      if (!state.speaker && "speechSynthesis" in window && window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
        speaking = false; setWave(false);
        if (state.call.active && !state.call.muted) startRec();
      }
    });
    $("kbBtn").addEventListener("click", function () {
      var fb = $("callFallback");
      var on = fb.hidden;
      fb.hidden = !on;
      this.setAttribute("aria-pressed", String(on));
      if (on) { var ci = $("callInput"); if (ci) { try { ci.focus(); } catch (e) {} } }
    });

    /* 채팅 입력 */
    $("form").addEventListener("submit", function (e) {
      e.preventDefault();
      var inp = $("input");
      var v = inp.value;
      inp.value = "";
      converse(v);
    });

    /* 입력창에 손을 대는 순간 중계 서버를 미리 깨운다(v1.1) */
    var inp = $("input");
    if (inp) {
      inp.addEventListener("focus", function () { warm(); });
      inp.addEventListener("keydown", function () { warm(); }, { passive: true });
    }

    /* 통화 입력(폴백) */
    $("callForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var ci = $("callInput");
      var v = ci.value;
      ci.value = "";
      if (!v.trim()) return;
      setCallSub(v.trim(), "say");
      converse(v, { fromCall: true });
    });

    /* 시트 */
    Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (el) {
      el.addEventListener("click", closeSheet);
    });
    $("nameSave").addEventListener("click", function () {
      var v = String($("nameInput").value || "").trim().slice(0, 12);
      state.name = v;
      LS.set("kimchi.name", v);
      renderHome();
      closeSheet();
      if (!v) { toast("이름을 비웠어요."); return; }
      toast(state.tone === "casual"
        ? withYa(v) + "라고 부를게."
        : v + "님이라고 부를게요.");
    });
    $("todoAdd").addEventListener("click", function () {
      var v = $("todoInput").value;
      if (!v.trim()) return;
      addTodo(v);
      $("todoInput").value = "";
    });
    $("todoInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); $("todoAdd").click(); }
    });

    /* 목소리 미리듣기 */
    var vt = $("voiceTest");
    if (vt) vt.addEventListener("click", function () { warm(); previewVoice(); });

    /* 설치 */
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      showInstall(true);
    });
    window.addEventListener("appinstalled", function () { showInstall(false); toast("김치를 홈 화면에 추가했어요."); });
    $("installGo").addEventListener("click", function () {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        Promise.resolve(deferredPrompt.userChoice).then(function () { deferredPrompt = null; showInstall(false); });
      } else { toast("브라우저 메뉴에서 ‘홈 화면에 추가’를 눌러 주세요."); }
    });
    $("installClose").addEventListener("click", function () {
      LS.set("kimchi.installOff", true);
      $("installBar").hidden = true;
    });
    $("sheetInstall").addEventListener("click", function () { $("installGo").click(); });

    /* 카카오톡 인앱 브라우저 */
    if (/KAKAOTALK/i.test(navigator.userAgent || "")) {
      var kb = $("kakaoBar");
      if (kb) kb.hidden = false;
      $("kakaoGo").addEventListener("click", function () {
        var url = location.href.replace(/^https?:\/\//, "");
        location.href = "intent://" + url + "#Intent;scheme=https;package=com.android.chrome;end";
      });
    }

    /* 음성 목록 — 기기 음성은 늦게 채워질 수 있어 두 번 그린다 */
    if ("speechSynthesis" in window && window.speechSynthesis) {
      renderVoiceUI();
      try { window.speechSynthesis.onvoiceschanged = function () { renderVoiceUI(); }; } catch (e) {}
    }

    /* 서비스 워커 (PWA) */
    if ("serviceWorker" in navigator && location.protocol === "https:") {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(function () {});
      });
    }

    /* ESC로 시트/통화 닫기 */
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!$("sheet").hidden) closeSheet();
      else if (state.call.active) endCall();
    });

    renderHome();
    showInstall(!!deferredPrompt);

    /* 페이지 진입 즉시 중계 서버 예열 — 첫 질문 전에 콜드 스타트를 끝낸다 */
    setTimeout(function () { warm(); }, 120);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  /* 테스트/디버그용 (읽기) */
  window.Kimchi = {
    state: state, ui: ui, ask: ask, converse: converse, warm: warm,
    presets: VOICE_PRESETS, voices: koVoices, resolveVoice: resolveVoice,
    preview: previewVoice, version: (CFG.version || "v1.1")
  };
})();
