/* TRACE/CON — content script.
 *
 * Injeta uma down-bar fixa no rodapé das corretoras suportadas.
 * A barra mostra:
 *   - sinal atual (BUY/SELL/WAIT) com cor
 *   - ativo operado (detectado da URL/DOM da corretora)
 *   - timeframe + probabilidade de acerto
 *   - botão atualizar (manual)
 *   - toggle "Auto-atualizar" (só atualiza; não clica em nada)
 *   - alerta sonoro + visual quando o sinal aparece
 *
 * Comunica-se com background.js via chrome.runtime.sendMessage para buscar
 * o sinal. O polling é responsabilidade do background (via chrome.alarms)
 * para sobreviver a navegação entre páginas.
 */

(() => {
  "use strict";

  if (window.__traceconInjected) return;
  window.__traceconInjected = true;

  // ------------------------------------------------------------
  // Detecção do ativo operado
  // ------------------------------------------------------------
  function detectAsset() {
    const host = location.host;
    const url = location.href;

    // TradingView: chart URL contains /symbols/<EXCHANGE>-<PAIR>/
    let m = url.match(/\/symbols\/([A-Z0-9]+)-([A-Z0-9]+)\b/i);
    if (m) return { symbol: m[1] + m[2], source: "tradingview-url" };

    // Binance: URL often contains /trade/<BASE>_<QUOTE> or symbol=BTCUSDT
    m = url.match(/\/trade\/([A-Z0-9]+)_([A-Z0-9]+)/i);
    if (m) return { symbol: m[1] + m[2], source: "binance-url" };

    // generic: ?symbol=BTCUSDT or ?pair=BTCUSDT
    const sp = new URLSearchParams(location.search);
    const q = sp.get("symbol") || sp.get("pair") || sp.get("t") || sp.get("asset");
    if (q && /^[A-Z0-9]{4,}$/i.test(q)) {
      return { symbol: q.toUpperCase(), source: "url-query" };
    }

    // fallback: title or h1 with pair like "BTC/USDT" or "BTCUSDT"
    const title = document.title;
    m = title.match(/([A-Z0-9]{2,5})\s*[\/\-]?\s*(USDT|USD|BUSD|BTC|ETH)/i);
    if (m) return { symbol: (m[1] + m[2]).toUpperCase(), source: "title" };

    return null;
  }

  function detectTimeframe() {
    // TradingView: interval in URL or local storage
    let m = location.href.match(/interval[\/=]([0-9]+[mhd]?)/i);
    if (m) return normalizeTimeframe(m[1]);
    const ls = localStorage.getItem("tradingview.chart.lastUsedInterval") ||
               localStorage.getItem("chart-settings");
    if (ls) {
      m = ls.match(/["']interval["']\s*:\s*["']?([0-9]+[mhd]?)["']?/i);
      if (m) return normalizeTimeframe(m[1]);
    }
    return "1h";
  }

  function normalizeTimeframe(raw) {
    const s = String(raw).toLowerCase();
    if (/^\d+$/.test(s)) return s + "m"; // TradingView sometimes uses "60" for 1h
    if (/^\d+[mhd]$/.test(s)) return s;
    return "1h";
  }

  // ------------------------------------------------------------
  // Áudio de alerta (WebAudio — sem asset externo)
  // ------------------------------------------------------------
  let audioCtx = null;
  function playAlert(kind) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const ctx = audioCtx;
      const now = ctx.currentTime;
      const freq = kind === "buy" ? 880 : kind === "sell" ? 440 : 0;
      if (!freq) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
      gain.gain.linearRampToValueAtTime(0, now + 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.45);

      // double-beep para BUY/SELL
      if (kind === "buy" || kind === "sell") {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.value = freq;
        gain2.gain.setValueAtTime(0, now + 0.2);
        gain2.gain.linearRampToValueAtTime(0.15, now + 0.22);
        gain2.gain.linearRampToValueAtTime(0, now + 0.6);
        osc2.connect(gain2).connect(ctx.destination);
        osc2.start(now + 0.2);
        osc2.stop(now + 0.65);
      }
    } catch (e) {
      // bloqueado pelo browser; ignore
    }
  }

  // ------------------------------------------------------------
  // UI: down-bar
  // ------------------------------------------------------------
  const root = document.createElement("div");
  root.id = "tracecon-bar-root";
  root.innerHTML = `
    <div class="tracecon-bar" id="tcBar" data-state="wait">
      <div class="tc-signal is-wait" id="tcSignal">
        <span class="tc-signal-pulse"></span>
        <span id="tcSignalText">WAIT</span>
      </div>
      <div class="tc-info" id="tcInfo">
        <span><b id="tcSymbol">—</b><span id="tcSymbolSource"></span></span>
        <span><b id="tcTimeframe">1h</b></span>
        <span class="tc-prob">prob: <b id="tcProb">—</b></span>
        <span class="tc-prob" id="tcCi" style="display:none">IC95: <b id="tcCiLower">—</b></span>
        <span class="tc-prob" id="tcEv" style="display:none">EV: <b id="tcEvVal">—</b></span>
        <span id="tcPrice" style="color:#6B7280"></span>
        <span id="tcReason" style="color:#F5A524; font-size:11px"></span>
      </div>
      <button class="tc-refresh" id="tcRefresh" type="button">Atualizar</button>
      <label class="tc-auto" id="tcAutoLabel" title="Auto-atualizar: só atualiza o sinal; não opera">
        <span>Auto</span>
        <span class="tc-auto-switch"></span>
      </label>
      <button class="tc-min" id="tcMin" type="button" aria-label="minimizar">─</button>
    </div>
    <div class="tc-error" id="tcError" hidden></div>
  `;
  document.body.appendChild(root);

  const bar = root.querySelector("#tcBar");
  const signalEl = root.querySelector("#tcSignal");
  const signalText = root.querySelector("#tcSignalText");
  const symbolEl = root.querySelector("#tcSymbol");
  const symbolSourceEl = root.querySelector("#tcSymbolSource");
  const tfEl = root.querySelector("#tcTimeframe");
  const probEl = root.querySelector("#tcProb");
  const ciEl = root.querySelector("#tcCi");
  const ciLowerEl = root.querySelector("#tcCiLower");
  const evEl = root.querySelector("#tcEv");
  const evValEl = root.querySelector("#tcEvVal");
  const reasonEl = root.querySelector("#tcReason");
  const priceEl = root.querySelector("#tcPrice");
  const refreshBtn = root.querySelector("#tcRefresh");
  const autoLabel = root.querySelector("#tcAutoLabel");
  const minBtn = root.querySelector("#tcMin");
  const errorEl = root.querySelector("#tcError");

  let lastSignal = null;
  let collapsed = false;
  let autoOn = false;

  // restore state from storage
  chrome.storage.local.get(["tcAuto", "tcCollapsed"], (s) => {
    autoOn = !!s.tcAuto;
    collapsed = !!s.tcCollapsed;
    applyAuto();
    applyCollapsed();
  });

  function applyAuto() {
    autoLabel.classList.toggle("is-on", autoOn);
    chrome.storage.local.set({ tcAuto: autoOn });
  }
  function applyCollapsed() {
    bar.classList.toggle("is-collapsed", collapsed);
    minBtn.textContent = collapsed ? "+" : "─";
    chrome.storage.local.set({ tcCollapsed: collapsed });
  }

  function setSignal(decision, payload) {
    const d = (decision || "WAIT").toUpperCase();
    signalEl.className = "tc-signal is-" + d.toLowerCase();
    signalText.textContent = d;
    bar.className = "tracecon-bar is-" + d.toLowerCase() + (collapsed ? " is-collapsed" : "");
    if (payload?.calibration?.calibratedProb != null) {
      probEl.textContent = (payload.calibration.calibratedProb * 100).toFixed(1) + "%";
    } else if (payload?.probability?.probability != null) {
      probEl.textContent = (payload.probability.probability * 100).toFixed(1) + "%";
    } else if (payload?.confidence != null) {
      probEl.textContent = (payload.confidence * 100).toFixed(1) + "%";
    } else {
      probEl.textContent = "—";
    }
    // IC95 inferior (calibração Wilson) — mostra quando houver
    if (payload?.calibration?.ciLower != null) {
      ciEl.style.display = "";
      ciLowerEl.textContent = (payload.calibration.ciLower * 100).toFixed(0) + "%";
    } else {
      ciEl.style.display = "none";
    }
    // Expected value
    if (payload?.calibration?.expectedValue != null) {
      evEl.style.display = "";
      const ev = payload.calibration.expectedValue;
      const sign = ev >= 0 ? "+" : "−";
      evValEl.textContent = `${sign}${Math.abs(ev * 100).toFixed(1)}%`;
      evValEl.style.color = ev >= 0 ? "var(--ok)" : "var(--bad)";
    } else {
      evEl.style.display = "none";
    }
    // Razão (por que WAIT?)
    const blockers = [];
    if (!payload?.guards?.allowed && payload?.guards?.reason) blockers.push(payload.guards.reason);
    if (payload?.confluence?.direction === "neutral" && payload?.confluence?.reason) blockers.push(payload.confluence.reason);
    if (d === "WAIT" && payload?.calibration && !payload.calibration.actionable) {
      blockers.push(`IC95 ${(payload.calibration.ciLower * 100).toFixed(0)}% ≤ baseline`);
    }
    if (blockers.length > 0) {
      reasonEl.textContent = "⚠ " + blockers[0];
    } else {
      reasonEl.textContent = "";
    }
    if (payload?.currentPrice != null) {
      priceEl.textContent = "@ " + Number(payload.currentPrice).toLocaleString("en-US", { maximumFractionDigits: 2 });
    } else {
      priceEl.textContent = "";
    }

    // alerta: só dispara quando MUDA o sinal
    if (lastSignal && lastSignal !== d && (d === "BUY" || d === "SELL")) {
      try { playAlert(d.toLowerCase()); } catch {}
      bar.animate(
        [{ transform: "translateY(0)" }, { transform: "translateY(-4px)" }, { transform: "translateY(0)" }],
        { duration: 400, iterations: 2 },
      );
    }
    lastSignal = d;
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function setError(msg) {
    bar.className = "tracecon-bar is-error" + (collapsed ? " is-collapsed" : "");
    signalEl.className = "tc-signal is-wait";
    signalText.textContent = "OFF";
    probEl.textContent = "—";
    priceEl.textContent = "";
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function setAsset(detected) {
    if (detected?.symbol) {
      symbolEl.textContent = detected.symbol;
      symbolSourceEl.textContent = detected.source ? " · " + detected.source : "";
    } else {
      symbolEl.textContent = "—";
      symbolSourceEl.textContent = "";
    }
  }
  function setTimeframe(tf) {
    tfEl.textContent = tf;
  }

  // ------------------------------------------------------------
  // Buscar sinal via background (service worker tem acesso ao storage)
  // ------------------------------------------------------------
  async function fetchSignal(triggeredByTimer = false) {
    const detected = detectAsset();
    const timeframe = detectTimeframe();
    setAsset(detected);
    setTimeframe(timeframe);
    if (!detected?.symbol) {
      setError("não consegui detectar o ativo nesta página — abra um gráfico específico");
      return;
    }
    refreshBtn.disabled = true;
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "tc.analyze",
        payload: { symbol: detected.symbol, timeframe, direction: "up", horizon: 12, triggeredByTimer },
      });
      if (!resp?.ok) throw new Error(resp?.error || "sem resposta do background");
      setSignal(resp.data.decision, resp.data);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      refreshBtn.disabled = false;
    }
  }

  // ------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------
  refreshBtn.addEventListener("click", () => fetchSignal(false));
  minBtn.addEventListener("click", () => { collapsed = !collapsed; applyCollapsed(); });
  autoLabel.addEventListener("click", () => {
    autoOn = !autoOn;
    applyAuto();
    chrome.runtime.sendMessage({ type: "tc.setAuto", payload: { auto: autoOn } });
    if (autoOn) fetchSignal(true);
  });

  // mensagens do background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "tc.tick") fetchSignal(true);
    if (msg?.type === "tc.notifySignal" && msg.payload) {
      setSignal(msg.payload.decision, msg.payload);
    }
  });

  // primeira carga
  fetchSignal(false);

  // re-detecta se URL muda (single-page apps)
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      fetchSignal(false);
    }
  }, 2000);
})();