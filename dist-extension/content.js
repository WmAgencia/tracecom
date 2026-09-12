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

  // IQ Option uses an isolated content world. The read-only bridge is loaded
  // in MAIN at document_start and posts only whitelisted inbound frames; this
  // script never reads credentials, cookies, storage or outgoing messages.
  if (/(^|\.)iqoption\.com$/i.test(location.hostname)) {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data;
      if (!data || data.channel !== "tracecon-iq-market" || !data.payload) return;
      const context = detectAsset();
      if (data.payload.type === "bridge-ready") {
        chrome.runtime.sendMessage({ type: "tc.iq.status", payload: { bridgeActive: true, symbol: context?.symbol || null, timeframe: detectTimeframe() } });
        return;
      }
      if (!context?.symbol) {
        chrome.runtime.sendMessage({ type: "tc.iq.status", payload: { bridgeActive: true, symbol: null, timeframe: data.payload.timeframe || null } });
        return; // never guess activeId -> symbol mapping
      }
      chrome.runtime.sendMessage({ type: "tc.iq.market", payload: { ...data.payload, symbol: context.symbol } });
    });
  }

  // ------------------------------------------------------------
  // Detecção do ativo operado
  // ------------------------------------------------------------
  function detectAsset() {
    const host = location.host;
    const url = location.href;

    if (/(^|\.)iqoption\.com$/i.test(host)) {
      const iq = document.title.match(/([A-Z]{3})\s*\/?\s*([A-Z]{3})(\s*[-_]?\s*OTC)?/i);
      if (iq) return { symbol: `${iq[1]}${iq[2]}${iq[3] ? "-OTC" : ""}`.toUpperCase(), source: "iqoption-title" };
      const selectorCandidates = [
        "[data-testid*='asset' i]", "[data-testid*='instrument' i]", "[class*='asset-name' i]", "[class*='instrument-name' i]",
      ];
      for (const selector of selectorCandidates) {
        const text = document.querySelector(selector)?.textContent?.trim() || "";
        const match = text.match(/([A-Z]{3})\s*\/?\s*([A-Z]{3})(\s*[-_]?\s*OTC)?/i);
        if (match) return { symbol: `${match[1]}${match[2]}${match[3] ? "-OTC" : ""}`.toUpperCase(), source: "iqoption-dom" };
      }
      const visible = (document.body?.innerText || "").slice(0, 20_000);
      const bodyMatch = visible.match(/\b([A-Z]{3})\s*\/\s*([A-Z]{3})(\s*[-_]?\s*OTC)?\b/i);
      if (bodyMatch) return { symbol: `${bodyMatch[1]}${bodyMatch[2]}${bodyMatch[3] ? "-OTC" : ""}`.toUpperCase(), source: "iqoption-visible-dom" };
    }

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
    // TRACE_1M intentionally does not mirror the broker chart interval. The
    // backend contract and the visible expiry both remain one minute.
    return "1m";
  }

  // ------------------------------------------------------------
  // Áudio de alerta (WebAudio — sem asset externo)
  // ------------------------------------------------------------
  let audioCtx = null;
  function playAlert(kind) {
    try {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
        <span id="tcShadowBadge" class="tc-shadow-badge" style="display:none">SHADOW ON</span>
        <span id="tcShadowPnl" class="tc-shadow-pnl" style="display:none">P&amp;L: <b id="tcShadowPnlVal">—</b></span>
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

  // Replace the legacy dense toolbar with a compact trading island. Keep the
  // legacy ids off-screen because the market/shadow code below still owns them.
  root.querySelector("#tcBar").innerHTML = `
    <div class="tc-identity"><span>Ativo</span><b id="tcSymbol">—</b><i id="tcSymbolSource"></i></div>
    <div class="tc-timeframe"><span>Janela</span><b>1 MIN</b></div>
    <div class="tc-entry"><span>Entrada</span><b>—</b></div>
    <div class="tc-countdown"><span>Janela</span><strong id="tcCountdown">00:00</strong></div>
    <div class="tc-decision"><div class="tc-signal is-wait" id="tcSignal"><em class="tc-signal-pulse"></em><b id="tcSignalText">WAIT</b></div><small id="tcReason">Analisando mercado</small></div>
    <div class="tc-prob"><span>Confiança</span><b id="tcProb">—</b></div>
    <div class="tc-feed" id="tcFeed" title="Feed de mercado"><i></i><b id="tcFeedText">ANALYZING</b></div>
    <button class="tc-min" id="tcMin" type="button" aria-label="expandir detalhes" title="Expandir detalhes">•••</button>
    <div class="tc-legacy" aria-hidden="true"><b id="tcTimeframe">1h</b><span id="tcCi"><b id="tcCiLower"></b></span><span id="tcEv"><b id="tcEvVal"></b></span><span id="tcPrice"></span><span id="tcShadowBadge"></span><span id="tcShadowPnl"><b id="tcShadowPnlVal"></b></span><button id="tcRefresh" type="button"></button><label id="tcAutoLabel"><span class="tc-auto-switch"></span></label></div>`;

  // Page detected is useful even when no candle has arrived yet. The server
  // receives no page text or account information, only this minimal context.
  if (/(^|\.)iqoption\.com$/i.test(location.hostname)) {
    const context = detectAsset();
    chrome.runtime.sendMessage({ type: "tc.iq.status", payload: { bridgeActive: true, symbol: context?.symbol || null, timeframe: detectTimeframe() } });
  }

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
  const shadowBadgeEl = root.querySelector("#tcShadowBadge");
  const shadowPnlEl = root.querySelector("#tcShadowPnl");
  const shadowPnlValEl = root.querySelector("#tcShadowPnlVal");
  const refreshBtn = root.querySelector("#tcRefresh");
  const autoLabel = root.querySelector("#tcAutoLabel");
  const minBtn = root.querySelector("#tcMin");
  const errorEl = root.querySelector("#tcError");
  const countdownEl = root.querySelector("#tcCountdown");
  const feedEl = root.querySelector("#tcFeed");
  const feedTextEl = root.querySelector("#tcFeedText");

  let lastSignal = null;
  let collapsed = false;
  let autoOn = false;
  let countdownTimer = null;

  // restore state from storage
  chrome.storage.local.get(["tcAuto", "tcCollapsed", "tcShadow", "tcShadowOn"], (s) => {
    autoOn = !!s.tcAuto;
    collapsed = !!s.tcCollapsed;
    applyAuto();
    applyCollapsed();
    applyShadowBadge();
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

  // ------------------------------------------------------------
  // Shadow trading (paper trading) — observa o que TERIA acontecido
  // se o usuário clicasse BUY/SELL quando o sinal apareceu.
  // NÃO executa nada. Apenas registra e mostra P&L atual.
  // ------------------------------------------------------------
  function readShadowEnabled(cb) {
    chrome.storage.local.get(["tcShadowEnabled"], (s) => {
      cb(s.tcShadowEnabled !== false);
    });
  }
  function applyShadowBadge() {
    chrome.storage.local.get(["tcShadowOn", "tcShadow"], (s) => {
      const open = s.tcShadowOn;
      const t = s.tcShadow;
      if (open && t) {
        shadowBadgeEl.style.display = "";
        shadowBadgeEl.textContent = `SHADOW ${t.decision} ON`;
      } else {
        shadowBadgeEl.style.display = "none";
        shadowBadgeEl.textContent = "SHADOW ON";
      }
      updateShadowPnlUI(t);
    });
  }
  function updateShadowPnlUI(t) {
    if (!t || !t.entryPrice || t.currentPrice == null) {
      shadowPnlEl.style.display = "none";
      shadowPnlValEl.textContent = "—";
      return;
    }
    const pct = ((t.currentPrice - t.entryPrice) / t.entryPrice) * 100;
    // P&L assinado pela direção: BUY quer pct>0, SELL quer pct<0
    let signed;
    if (t.decision === "BUY") signed = pct;
    else if (t.decision === "SELL") signed = -pct;
    else signed = pct;
    const sign = signed >= 0 ? "+" : "−";
    shadowPnlValEl.textContent = `${sign}${Math.abs(signed).toFixed(2)}%`;
    shadowPnlEl.style.display = "";
    shadowPnlValEl.style.color = signed >= 0 ? "#4ADE80" : "#F87171";
  }
  function openShadowTrade(decision, payload) {
    const entryPrice = payload?.currentPrice;
    if (entryPrice == null || !Number.isFinite(entryPrice)) return;
    const trade = {
      symbol: payload.symbol || symbolEl.textContent || null,
      timeframe: tfEl.textContent || null,
      direction: payload.direction || "up",
      decision,
      entryTime: Date.now(),
      entryPrice,
      currentPrice: entryPrice,
      confidence: payload?.confidence ?? null,
      probability: payload?.probability?.probability ?? payload?.calibration?.calibratedProb ?? null,
    };
    chrome.storage.local.set({ tcShadowOn: trade, tcShadow: trade }, () => {
      applyShadowBadge();
      chrome.runtime.sendMessage({ type: "tc.shadowOpen", payload: trade });
      setTimeout(() => {
        chrome.storage.local.get(["tcShadowOn"], (state) => {
          if (state.tcShadowOn?.entryTime === trade.entryTime) closeShadowTrade("expiry_60s", state.tcShadowOn.currentPrice);
        });
      }, 60_250);
    });
  }
  function closeShadowTrade(reason, currentPrice) {
    chrome.storage.local.get(["tcShadowOn"], (s) => {
      const t = s.tcShadowOn;
      if (!t) return;
      const closed = {
        ...t,
        exitTime: Date.now(),
        exitPrice: currentPrice ?? t.currentPrice ?? null,
        closeReason: reason,
      };
      const entry = Number(closed.entryPrice);
      const exit = Number(closed.exitPrice);
      const rawReturn = Number.isFinite(entry) && entry > 0 && Number.isFinite(exit) ? (exit - entry) / entry : null;
      const signedReturn = rawReturn === null ? null : closed.decision === "SELL" ? -rawReturn : rawReturn;
      closed.outcome = signedReturn === null ? "UNKNOWN" : Math.abs(signedReturn) < 0.00001 ? "DRAW" : signedReturn > 0 ? "WIN" : "LOSS";
      closed.returnPct = signedReturn === null ? null : signedReturn * 100;
      // empurra pro histórico e limpa o aberto
      chrome.storage.local.get(["tcShadowHistory"], (h) => {
        const history = Array.isArray(h.tcShadowHistory) ? h.tcShadowHistory : [];
        history.push(closed);
        // mantém últimos 50
        while (history.length > 50) history.shift();
        chrome.storage.local.set(
          { tcShadowOn: null, tcShadow: null, tcShadowHistory: history },
          () => {
            applyShadowBadge();
            // pede pro background enviar pro backend
            chrome.runtime.sendMessage({ type: "tc.shadowClose", payload: closed });
          },
        );
      });
    });
  }

  function setSignal(decision, payload) {
    const rawDecision = (decision || "WAIT").toUpperCase();
    const ev = Number(payload?.calibration?.expectedValue);
    // Safety boundary: a directional payload with non-positive EV is rendered
    // as WAIT until the backend supplies a positive, evidence-backed edge.
    const d = (Number.isFinite(ev) && ev <= 0 && (rawDecision === "BUY" || rawDecision === "SELL")) ? "WAIT" : rawDecision;
    const plannedEntryAt = Number(payload?.entryAt ?? payload?.signal?.entryAt);
    signalEl.className = "tc-signal is-" + d.toLowerCase();
    signalText.textContent = d;
    const showCountdown = d === "BUY" || d === "SELL";
    bar.className = "tracecon-bar is-" + d.toLowerCase() + (collapsed ? " is-collapsed" : "") + (showCountdown ? " is-countdown" : "");
    if (!showCountdown) countdownEl.textContent = "00:00";
    else if (Number.isFinite(plannedEntryAt) && plannedEntryAt > Date.now()) beginCountdown(plannedEntryAt);
    else countdownEl.textContent = "00:00";
    const localOnly = payload?.backend === "UNREACHABLE" || payload?.backend === "HTTP_ERROR";
    feedEl.dataset.state = localOnly ? "offline" : "synced";
    feedTextEl.textContent = localOnly ? "LOCAL SHADOW" : "SYNCED";
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
    if (d === "WAIT" && rawDecision !== "WAIT" && Number.isFinite(ev) && ev <= 0) blockers.push(`EV não positivo (${ev.toFixed(3)})`);
    if (!payload?.guards?.allowed && payload?.guards?.reason) blockers.push(payload.guards.reason);
    if (payload?.confluence?.direction === "neutral" && payload?.confluence?.reason) blockers.push(payload.confluence.reason);
    if (payload?.diagnostic?.errorClass) blockers.push(`${payload.diagnostic.errorClass}: ${payload.diagnostic.message}`);
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
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches) bar.animate(
        [{ transform: "translateY(0)" }, { transform: "translateY(-2px)" }, { transform: "translateY(0)" }],
        { duration: 300, iterations: 1 },
      );
    }

    // shadow trading: abre / atualiza / fecha conforme o sinal
    readShadowEnabled((shadowEnabled) => {
      const symbol = payload?.symbol || symbolEl.textContent;
      const timeframe = tfEl.textContent;
      const currentPrice = payload?.currentPrice;
      chrome.storage.local.get(["tcShadowOn"], (s) => {
        const open = s.tcShadowOn;
        const isDirectional = d === "BUY" || d === "SELL";
        if (!shadowEnabled) {
          // shadow off: se sobrou trade aberto de antes, limpa silenciosamente
          if (open) {
            chrome.storage.local.set({ tcShadowOn: null, tcShadow: null }, () => {
              applyShadowBadge();
            });
          }
          return;
        }
        // sinal BUY/SELL: abre shadow se não há trade aberto (ou se é outro símbolo/TF)
        if (isDirectional) {
          if (!open) {
            openShadowTrade(d, {
              symbol,
              timeframe,
              direction: payload?.direction || "up",
              currentPrice,
              confidence: payload?.confidence,
              probability: payload?.probability,
              calibration: payload?.calibration,
            });
          } else {
            // já existe: atualiza currentPrice e verifica se mudou de direção/símbolo/TF
            if (currentPrice != null) {
              // mesma direção/símbolo/TF: só atualiza P&L
              const updated = { ...open, currentPrice };
              chrome.storage.local.set({ tcShadowOn: updated, tcShadow: updated }, () => {
                applyShadowBadge();
              });
            }
          }
        } else if (open && !isDirectional && currentPrice != null) {
          // WAIT does not rewrite an earlier paper decision. Keep the latest
          // observed price; the backend evaluates the immutable entry at T+60s.
          const updated = { ...open, currentPrice };
          chrome.storage.local.set({ tcShadowOn: updated, tcShadow: updated }, applyShadowBadge);
        }
      });
    });

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
    feedEl.dataset.state = "offline";
    feedTextEl.textContent = "OFFLINE";
    countdownEl.textContent = "00:00";
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function setAsset(detected) {
    if (detected?.symbol) {
      const pair = detected.symbol.match(/^([A-Z]{3})([A-Z]{3})(-OTC)?$/);
      symbolEl.textContent = pair ? `${pair[1]}/${pair[2]}${pair[3] ? " OTC" : ""}` : detected.symbol;
      symbolSourceEl.textContent = detected.source || "";
    } else {
      symbolEl.textContent = "—";
      symbolSourceEl.textContent = "";
    }
  }
  function setTimeframe(tf) {
    tfEl.textContent = tf;
  }

  function beginCountdown(entryAt) {
    if (!Number.isFinite(entryAt)) return;
    if (lastSignal === "BUY" || lastSignal === "SELL") bar.classList.add("is-countdown");
    const render = () => {
      const remaining = Math.max(0, Math.ceil((entryAt - Date.now()) / 1000));
      countdownEl.textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
      if (remaining === 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
      }
    };
    if (countdownTimer) clearInterval(countdownTimer);
    render();
    countdownTimer = setInterval(render, 1000);
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
        payload: { symbol: detected.symbol, timeframe, direction: "up", horizon: 1, triggeredByTimer },
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
    if (msg?.type === "tc.iq.marketAccepted") {
      clearTimeout(marketRefreshTimer);
      marketRefreshTimer = setTimeout(() => fetchSignal(true), 750);
    }
    if (msg?.type === "tc.notifySignal" && msg.payload) {
      const detected = detectAsset();
      const currentTf = detectTimeframe();
      const normalizeSymbol = (value) => String(value || "").toUpperCase().replace(/[^A-Z]/g, "").replace(/OTC$/, "");
      if (
        detected?.symbol &&
        normalizeSymbol(msg.payload.symbol) === normalizeSymbol(detected.symbol) &&
        (!msg.payload.timeframe || msg.payload.timeframe === currentTf)
      ) {
        setSignal(msg.payload.decision, msg.payload);
      }
    }
    if (msg?.type === "tc.downbarPreference") {
      root.hidden = msg.payload?.enabled === false;
    }
  });

  chrome.storage.local.get(["tcDownbarEnabled"], (s) => { root.hidden = s.tcDownbarEnabled === false; });

  // primeira carga
  let marketRefreshTimer = null;
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
