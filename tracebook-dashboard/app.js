/* ============================================================================
   PAINEL TRACECOM — só apresenta o que o backend já calculou.
   Não fala com a IQ, não envia ordem, não decide nada operacional.
   ========================================================================== */
const $ = (id) => document.getElementById(id);
const THEME_KEY = 'tracecom-panel-theme';

/* ─── WebSocket — atualização em tempo real ──────────────────────────────────── */
let wsPanel = null;
let wsReconnectTimer = null;

function wsConnect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}:8080`;
  try {
    wsPanel = new WebSocket(url);
  } catch {
    scheduleWsReconnect();
    return;
  }

  wsPanel.onopen = () => {
    wsPanel.send(JSON.stringify({ type: 'browser_hello' }));
    console.log('[WS] conectado ao painel');
  };

  wsPanel.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.type === 'state_snapshot' || msg.type === 'telemetry') {
      applyTelemetryUpdate(msg.payload);
    } else if (msg.type === 'account_switched') {
      refreshRuntime();
    } else if (msg.type === 'bot_disconnected') {
      if (state.runtime) {
        state.runtime.connection = { ws: 'OFFLINE', feed: 'NO_FEED' };
        renderTaskbar();
      }
    }
  };

  wsPanel.onclose = () => { wsPanel = null; scheduleWsReconnect(); };
  wsPanel.onerror = () => { wsPanel?.close(); };
}

function scheduleWsReconnect() {
  clearTimeout(wsReconnectTimer);
  wsReconnectTimer = setTimeout(wsConnect, 5_000);
}

function wsSendCommand(action, payload = {}) {
  if (wsPanel?.readyState === WebSocket.OPEN) {
    wsPanel.send(JSON.stringify({ type: 'command', action, payload }));
    return true;
  }
  return false;
}

function applyTelemetryUpdate(payload) {
  if (!payload) return;
  if (payload.runtime) {
    state.runtime = { ...state.runtime, ...payload.runtime };
    if (payload.runtime.account) state.runtime.account = payload.runtime.account;
  }
  if (payload.stats) {
    state.stats = { day: payload.stats, week: payload.stats, month: payload.stats };
  }
  render();
}

const state = {
  runtime: null,
  stats: null,
  engine: null,
  stake: null,
  history: { range: 'day', tab: 'trades' },
  stakeEditing: false,
  busy: false,
};

/* ─── utilidades ─────────────────────────────────────────────────────────── */
const dec = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(value, symbol = state.runtime?.stake?.currency ?? 'R$', withSign = false) {
  const n = Number(value) || 0;
  const sign = withSign ? (n > 0 ? '+' : n < 0 ? '-' : '') : (n < 0 ? '-' : '');
  return `${sign}${symbol} ${dec.format(Math.abs(n))}`;
}
function percent(value) { return `${dec.format(Number(value) || 0)}%`; }
function hhmmss(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
function clock(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function cls(n) { return Number(n) > 0 ? 'pos' : Number(n) < 0 ? 'neg' : 'neutral'; }
function kindLabel(kind) {
  if (kind === 'pyramid') return 'pirâmide';
  if (kind === 'reversalGale') return 'martingale';
  if (kind === 'gale') return 'reentrada';
  return 'entrada';
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data: data ?? {} };
}

let toastTimer = null;
function banner(text, kind = 'ok') {
  const el = $('banner');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.className = `alert ${kind === 'error' ? 'error' : 'ok'}`;
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

/* ─── tema ───────────────────────────────────────────────────────────────── */
function applyTheme(theme, { persist = true } = {}) {
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  if (persist) { try { localStorage.setItem(THEME_KEY, next); } catch { /* modo privado */ } }
  for (const btn of document.querySelectorAll('[data-theme-set]')) {
    btn.setAttribute('aria-checked', String(btn.dataset.themeSet === next));
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = next === 'dark' ? '#0b0e13' : '#f3f5f9';
}
function initialTheme() {
  const url = new URLSearchParams(location.search).get('theme');
  if (url === 'light' || url === 'dark') return url;
  try { return localStorage.getItem(THEME_KEY) ?? 'dark'; } catch { return 'dark'; }
}

/* ─── render ─────────────────────────────────────────────────────────────── */
function sessionLive() {
  const rt = state.runtime;
  if (!rt) return null;
  const live = rt.live;
  if (rt.state !== 'RUNNING' || !live || rt.connection?.stale) return null;
  return live;
}

function renderTaskbar() {
  const rt = state.runtime;
  const live = sessionLive();
  const btn = $('power');
  const rtState = rt?.state ?? 'STOPPED';
  btn.dataset.state = rtState;
  const labels = { STOPPED: 'ATIVAR', STARTING: 'ATIVANDO...', RUNNING: 'DESATIVAR', STOPPING: 'DESATIVANDO...', DEGRADED: 'DESATIVAR' };
  $('power-label').textContent = state.busy ? 'AGUARDE...' : (labels[rtState] ?? 'ATIVAR');
  btn.disabled = state.busy;
  btn.setAttribute('aria-busy', String(state.busy));
  btn.title = rtState === 'STOPPED' ? 'sobe o bot pelo mesmo comando de sempre' : 'para o bot pelo mesmo shutdown da tecla K';

  const account = rt?.account?.label ?? '--';
  const chip = $('chip-account');
  chip.textContent = account;
  chip.className = `chip ${rt?.account?.mode === 'real' ? 'chip-bad' : ''}`;

  // Account switcher: atualiza qual botão está ativo
  const isReal = rt?.account?.mode === 'real';
  $('btn-account-demo')?.classList.toggle('chip-active', !isReal);
  $('btn-account-real')?.classList.toggle('chip-active', isReal);

  const conn = rt?.connection ?? { ws: 'OFFLINE', feed: 'NO_FEED', candles: 0 };
  const feedChip = $('chip-feed');
  feedChip.textContent = conn.ws === 'CONNECTED' ? `IQ ${conn.feed === 'LIVE' ? 'OK' : 'SEM FEED'}` : conn.ws === 'CONNECTING' ? 'IQ CONECTANDO' : 'IQ OFFLINE';
  feedChip.className = `chip ${conn.ws === 'CONNECTED' && conn.feed === 'LIVE' ? 'chip-ok' : conn.ws === 'OFFLINE' ? '' : 'chip-warn'}`;
  feedChip.title = live ? `${live.universe?.size ?? 0} ativos no universo · ${conn.candles} candles 5s fechados` : 'sem feed';

  const proof = state.engine?.proof;
  const engineChip = $('chip-engine');
  engineChip.textContent = proof?.status === 'PASS' ? 'MOTOR INTACTO' : proof?.status === 'FAIL' ? 'MOTOR ALTERADO' : 'MOTOR ?';
  engineChip.className = `chip ${proof?.status === 'PASS' ? 'chip-ok' : proof?.status === 'FAIL' ? 'chip-bad' : ''}`;
  engineChip.title = proof?.status === 'PASS'
    ? `prova de não-regressão: motor idêntico (${String(proof.fingerprint ?? '').slice(0, 12)})`
    : 'prova de não-regressão não disponível';
}

function renderStake() {
  const stake = state.stake ?? state.runtime?.stake;
  if (!stake) return;
  state.stake = stake;
  const input = $('stake-input');
  if (!state.stakeEditing && document.activeElement !== input) {
    input.value = dec.format(Number(stake.configured) || 0);
  }
  $('stake-sym').textContent = stake.currency;
  const note = $('stake-note');
  if (stake.pending) {
    note.className = 'stake-note warn';
    note.textContent = `em operação agora: ${money(stake.applied, stake.currency)} · o novo valor aplica no próximo ATIVAR`;
  } else {
    note.className = 'stake-note';
    note.textContent = `em operação: ${money(stake.applied, stake.currency)}`;
  }
  $('settings-stake-hint').textContent = `mínimo ${money(stake.min, stake.currency)} · máximo seguro ${money(stake.max, stake.currency)} (senão a ordem de recuperação estoura o teto por ordem de ${money(stake.maxStake, stake.currency)})`;
  const settingsInput = $('settings-stake');
  if (document.activeElement !== settingsInput) settingsInput.value = dec.format(Number(stake.configured) || 0);
  $('set-stake-applied').textContent = money(stake.applied, stake.currency);
}

function renderHero() {
  const day = state.stats?.ranges?.day ?? { ops: 0, wins: 0, losses: 0, draws: 0, wr: 0, profit: 0 };
  $('m-ops').textContent = String(day.ops);
  $('m-wins').textContent = String(day.wins);
  $('m-loss').textContent = String(day.losses);
  $('m-draw').textContent = String(day.draws);
  $('m-draw-wrap').hidden = !day.draws;
  $('m-wr').textContent = percent(day.wr);

  const profitEl = $('profit-day');
  profitEl.textContent = money(day.profit, state.runtime?.stake?.currency, true);
  profitEl.className = `profit ${cls(day.profit)}`;

  const live = sessionLive();
  const session = state.runtime?.session;
  const rtState = state.runtime?.state ?? 'STOPPED';
  const sp = live ? live.stats?.profit ?? 0 : session?.stats?.profit ?? 0;
  const sProfitEl = $('session-profit');
  sProfitEl.textContent = money(sp, state.runtime?.stake?.currency, true);
  sProfitEl.className = `session-value ${cls(sp)}`;

  const ops = live ? live.stats?.settled ?? 0 : session?.stats?.ops ?? 0;
  const wins = live ? live.stats?.wins ?? 0 : session?.stats?.wins ?? 0;
  const losses = live ? live.stats?.losses ?? 0 : session?.stats?.losses ?? 0;
  const wr = live ? live.stats?.wr ?? 0 : session?.stats?.wr ?? 0;
  $('session-label').textContent = rtState === 'STOPPED' ? 'ÚLTIMA SESSÃO' : 'SESSÃO ATUAL';
  $('session-meta').textContent = rtState === 'STOPPED'
    ? (session?.endedAt ? `encerrada ${clock(session.endedAt)} · ${session.endReason ?? '--'} · ${ops} ops` : 'sem sessão ativa')
    : `${ops} ops · ${wins}W/${losses}L · ${percent(wr)}${live ? '' : ' · aguardando feed'}`;

  const stateLabels = { STOPPED: 'parado', STARTING: 'conectando...', RUNNING: 'em operação', STOPPING: 'encerrando...', DEGRADED: 'sem telemetria' };
  $('session-state').textContent = stateLabels[rtState] ?? '--';

  const startIso = live?.startedAt ? new Date(live.startedAt).toISOString() : state.runtime?.startedAt ?? null;
  tickTimer(startIso);
}

let timerAnchor = null;
function tickTimer(startIso) {
  timerAnchor = startIso ?? timerAnchor;
  const el = $('session-timer');
  el.textContent = (state.runtime?.state === 'RUNNING' || state.runtime?.state === 'DEGRADED') && timerAnchor
    ? hhmmss(Date.now() - Date.parse(timerAnchor))
    : '00:00:00';
  el.title = timerAnchor ? `início ${clock(timerAnchor)}` : 'sem sessão';
}

function renderStats() {
  const cur = state.runtime?.stake?.currency;
  const week = state.stats?.ranges?.week ?? { ops: 0, profit: 0, wr: 0 };
  const month = state.stats?.ranges?.month ?? { ops: 0, profit: 0, wr: 0 };
  $('profit-week').textContent = money(week.profit, cur, true);
  $('profit-week').className = `stat-value ${cls(week.profit)}`;
  $('week-meta').textContent = `${week.ops} operações · WR ${percent(week.wr)}`;
  $('profit-month').textContent = money(month.profit, cur, true);
  $('profit-month').className = `stat-value ${cls(month.profit)}`;
  $('month-meta').textContent = `${month.ops} operações · WR ${percent(month.wr)}`;

  const live = sessionLive();
  const open = live?.openStake ?? 0;
  const limit = live?.exposureLimit ?? 0;
  const balance = live?.balance ?? 0;
  $('exposure').textContent = money(open, cur);
  const pct = limit > 0 ? Math.min(100, (open / limit) * 100) : 0;
  const bar = $('exposure-bar');
  bar.style.width = `${pct.toFixed(1)}%`;
  bar.className = pct >= 90 ? 'warn' : '';
  $('exposure-meta').textContent = live
    ? `teto ${money(limit, cur)} (${live.config?.maxExposurePct ?? 0}% de ${money(balance, cur)})`
    : 'sem posições (bot parado)';
}

function renderPositions() {
  const live = sessionLive();
  const list = $('positions');
  const positions = live?.openPositions ?? [];
  $('open-count').textContent = String(positions.length);
  if (!positions.length) {
    list.innerHTML = '<li class="empty">nenhuma posição aberta</li>';
    return;
  }
  list.innerHTML = positions.map((p) => `
    <li>
      <span><b>${p.asset}</b> <span class="tag">${kindLabel(p.kind)}</span></span>
      <span class="${p.direction === 'CALL' ? 'pos' : 'neg'}">${p.direction}</span>
      <b>${money(p.stake, state.runtime?.stake?.currency)}</b>
    </li>`).join('');
}

function renderEvents(events) {
  const list = $('events');
  $('feed-count').textContent = String(events.length);
  if (!events.length) { list.innerHTML = '<li class="empty">sem eventos ainda</li>'; return; }
  list.innerHTML = events.slice(0, 60).map((e) => `
    <li class="${e.level === 'error' ? 'warn' : e.level === 'warn' ? 'warn' : 'info'}">
      <span class="dot"></span>
      <span class="txt" title="${String(e.text ?? '').replace(/"/g, '&quot;')}">${e.text ?? ''}</span>
      <span class="time">${clock(e.at)}</span>
    </li>`).join('');
}

function renderEngineInfo() {
  const cfg = state.engine?.config ?? {};
  const proof = state.engine?.proof;
  $('set-account').textContent = state.runtime?.account?.label ?? '--';
  $('set-expiry').textContent = `${cfg.trading?.expirationMinutes ?? '--'} minutos`;
  $('set-cycle').textContent = `${cfg.trading?.maxOpsPerAsset ?? '--'} ordens por ativo`;
  $('set-maxstake').textContent = money(cfg.risk?.maxStake ?? 0, state.runtime?.stake?.currency);
  $('set-exposure').textContent = `${cfg.risk?.maxExposurePct ?? '--'}% do saldo`;
  $('set-sessionloss').textContent = `${cfg.risk?.maxSessionLossPct ?? '--'}% do saldo inicial`;
  $('set-proof').textContent = proof?.status === 'PASS' ? `idêntico (${String(proof.fingerprint ?? '').slice(0, 12)}...)` : proof?.status ?? '--';
  $('foot-hash').textContent = String(state.engine?.engine?.fileHash ?? '--').slice(0, 8);
  $('foot-proof').textContent = `prova: ${proof?.status ?? '--'}`;
  $('foot-updated').textContent = `atualizado ${clock(new Date().toISOString())}`;
}

function render() {
  const offline = $('offline');
  offline.hidden = Boolean(state.runtime);
  renderTaskbar();
  if (!state.runtime) return;
  renderStake();
  renderHero();
  renderStats();
  renderPositions();
  renderEngineInfo();
}

/* ─── ações ──────────────────────────────────────────────────────────────── */
let confirmResolve = null;
function askConfirm({ title, text, okLabel = 'Confirmar', danger = true, requireText = null }) {
  const dialog = $('confirm');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  const ok = $('confirm-ok');
  ok.textContent = okLabel;
  ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  ok.disabled = Boolean(requireText);
  let typed = null;
  if (requireText) {
    typed = document.createElement('input');
    typed.className = 'input';
    typed.placeholder = `digite ${requireText} para liberar`;
    typed.style.marginTop = '12px';
    typed.addEventListener('input', () => { ok.disabled = typed.value.trim().toUpperCase() !== requireText; });
    typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    $('confirm-text').after(typed);
  }
  return new Promise((resolve) => {
    confirmResolve = resolve;
    dialog.returnValue = '';
    dialog.showModal();
    const cleanup = () => {
      dialog.removeEventListener('close', onClose);
      typed?.remove();
      confirmResolve = null;
    };
    const onClose = () => { const ok2 = dialog.returnValue === 'ok'; cleanup(); resolve(ok2); };
    dialog.addEventListener('close', onClose);
  });
}

/* ─── conta / login ──────────────────────────────────────────────────────── */
let accountLoggedIn = false;

async function refreshAuthStatus() {
  const res = await api('/api/auth/status');
  if (res.ok) {
    accountLoggedIn = res.data.loggedIn;
    renderLoginStatus();
  }
}

function renderLoginStatus() {
  const statusEl = $('login-status');
  const formEl = $('login-form');
  const loginSection = $('login-section');
  if (!loginSection) return;
  if (accountLoggedIn) {
    loginSection.querySelector('.login-logged-in')?.classList.remove('hidden');
    loginSection.querySelector('.login-form-fields')?.classList.add('hidden');
    const emailEl = loginSection.querySelector('.login-email-display');
    if (emailEl) api('/api/auth/status').then(r => { if (r.ok && r.data.email) emailEl.textContent = r.data.email; });
  } else {
    loginSection.querySelector('.login-logged-in')?.classList.add('hidden');
    loginSection.querySelector('.login-form-fields')?.classList.remove('hidden');
  }
}

async function doLogin() {
  const email = $('login-email-input')?.value?.trim();
  const password = $('login-password-input')?.value;
  if (!email || !password) { banner('Preencha e-mail e senha.', 'error'); return; }
  banner('Salvando credenciais...', 'ok');
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (!res.ok) { banner(res.data?.error ?? 'Erro ao salvar.', 'error'); return; }
  accountLoggedIn = true;
  renderLoginStatus();
  banner('Credenciais salvas. Inicie o bot.', 'ok');
}

async function doLogout() {
  const ok = await askConfirm({ title: 'Sair da conta', text: 'Remover as credenciais salvas?', okLabel: 'REMOVER', danger: false });
  if (!ok) return;
  const res = await api('/api/auth/logout', { method: 'POST' });
  accountLoggedIn = false;
  renderLoginStatus();
  banner('Credenciais removidas.', 'ok');
}

async function switchAccount(mode) {
  const label = mode === 'real' ? 'REAL' : 'PRACTICE (demo)';
  const ok = await askConfirm({
    title: `Trocar para conta ${label}`,
    text: `O bot vai operar na conta ${label} na próxima vez que for ativado. Continuar?`,
    okLabel: `TROCAR PARA ${label}`,
    danger: false,
  });
  if (!ok) return;
  banner(`Trocando para ${label}...`, 'ok');
  const res = await api('/api/account/switch', { method: 'POST', body: { mode } });
  if (!res.ok) { banner(res.data?.error ?? 'Erro ao trocar conta.', 'error'); return; }
  await refreshRuntime();
  renderTaskbar();
  banner(`Conta trocada para ${label}.`, 'ok');
}

async function togglePower() {
  const rt = state.runtime;
  if (!rt || state.busy) return;
  state.busy = true; renderTaskbar();
  try {
    if (rt.state === 'STOPPED') {
      const isReal = rt.account?.mode === 'real';
      if (isReal) {
        const ok = await askConfirm({
          title: 'Ativar na conta REAL',
          text: 'Esta conta é a REAL. O bot vai operar com dinheiro real pelas mesmas regras. Confirme digitando REAL.',
          okLabel: 'ATIVAR REAL', requireText: 'REAL',
        });
        if (!ok) return;
      }
      const res = await api('/api/runtime/start', { method: 'POST', body: { confirm: isReal ? 'REAL' : null } });
      if (!res.ok) banner(res.data?.message ?? `não foi possível ativar (${res.data?.code ?? res.status})`, 'error');
      else banner('ATIVANDO — o bot está subindo (login, feed e hidratação).', 'ok');
    } else {
      const res = await api('/api/runtime/stop', { method: 'POST', body: { force: false } });
      if (!res.ok && res.data?.code === 'OPEN_POSITIONS') {
        const ok = await askConfirm({
          title: 'Posições abertas',
          text: `Existem ${res.data.open} posição(ões) aberta(s). Parar agora abandona o acompanhamento delas (elas seguem no broker até o vencimento). Parar mesmo assim?`,
          okLabel: 'PARAR MESMO ASSIM',
        });
        if (!ok) return;
        const forced = await api('/api/runtime/stop', { method: 'POST', body: { force: true } });
        if (!forced.ok) banner(forced.data?.message ?? 'falha ao parar', 'error');
        else banner('DESATIVANDO — encerrando pelo mesmo fluxo da tecla K.', 'ok');
      } else if (!res.ok) {
        banner(res.data?.message ?? `não foi possível desativar (${res.data?.code ?? res.status})`, 'error');
      } else {
        banner('DESATIVANDO — o bot vai fechar e salvar o resultado final.', 'ok');
      }
    }
  } finally {
    state.busy = false;
    await refreshRuntime();
    render();
  }
}

async function saveStake(value, { fromSettings = false } = {}) {
  const res = await api('/api/stake', { method: 'POST', body: { value } });
  if (!res.ok) {
    banner(res.data?.message ?? 'valor não aceito pelo servidor', 'error');
    await refreshRuntime();     // volta ao último valor CONFIRMADO
    state.stakeEditing = false;
    render();
    return;
  }
  state.stake = res.data;
  state.stakeEditing = false;
  banner(`Valor fixo confirmado: ${money(res.data.configured, res.data.currency)}${res.data.pending ? ' (aplica no próximo ATIVAR)' : ''}`);
  render();
  if (fromSettings) await refreshRuntime();
}

function parseStakeInput(text) {
  const clean = String(text ?? '').replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  return Number(clean);
}

/* ─── histórico ──────────────────────────────────────────────────────────── */
async function renderHistory() {
  const { range, tab } = state.history;
  const res = await api(`/api/history?range=${range}&limit=300`);
  if (!res.ok) return;
  const data = res.data;
  const cur = state.runtime?.stake?.currency;
  const sum = data.trades.reduce((acc, t) => {
    acc.ops++; if (t.outcome === 'win') acc.w++; else if (t.outcome === 'loss') acc.l++; else acc.d++;
    acc.profit += Number(t.profit) || 0; return acc;
  }, { ops: 0, w: 0, l: 0, d: 0, profit: 0 });
  const wr = sum.w + sum.l > 0 ? (sum.w / (sum.w + sum.l)) * 100 : 0;
  $('history-summary').innerHTML = `${sum.ops} operações · <b class="pos">${sum.w} W</b> · <b class="neg">${sum.l} L</b>${sum.d ? ` · ${sum.d} draw` : ''} · WR ${percent(wr)} · resultado <b class="${cls(sum.profit)}">${money(sum.profit, cur, true)}</b> · ${data.sessions.length} sessão(ões)`;

  const head = $('history-head');
  const body = $('history-body');
  if (tab === 'trades') {
    head.innerHTML = '<tr><th>Hora</th><th>Ativo</th><th>Direção</th><th>Ordem</th><th>Valor</th><th>Resultado</th><th>PnL</th></tr>';
    body.innerHTML = data.trades.length ? data.trades.map((t) => `
      <tr>
        <td>${clock(t.settledAt ?? t.sentAt)}</td>
        <td>${t.asset ?? '--'}</td>
        <td class="${t.direction === 'CALL' ? 'pos' : 'neg'}">${t.direction ?? '--'}</td>
        <td>${kindLabel(t.kind)}</td>
        <td>${money(t.stake, cur)}</td>
        <td><span class="pill ${cls(t.profit)}">${t.earlySell ? 'venda' : t.outcome === 'win' ? 'WIN' : t.outcome === 'loss' ? 'LOSS' : 'DRAW'}</span></td>
        <td class="${cls(t.profit)}"><b>${money(t.profit, cur, true)}</b></td>
      </tr>`).join('') : '<tr class="empty-row"><td colspan="7">sem operações no período</td></tr>';
  } else {
    head.innerHTML = '<tr><th>Início</th><th>Duração</th><th>Conta</th><th>Ops</th><th>W</th><th>L</th><th>WR</th><th>Lucro</th><th>Fim</th></tr>';
    body.innerHTML = data.sessions.length ? data.sessions.map((s) => {
      const start = Date.parse(s.startedAt ?? s.requestedAt ?? 0);
      const end = s.endedAt ? Date.parse(s.endedAt) : Date.now();
      const dur = Number.isFinite(start) ? hhmmss(end - start) : '--';
      return `
      <tr>
        <td>${clock(s.startedAt ?? s.requestedAt)}</td>
        <td>${dur}</td>
        <td>${s.account?.type ?? '--'}</td>
        <td>${s.stats?.ops ?? 0}</td>
        <td class="pos">${s.stats?.wins ?? 0}</td>
        <td class="neg">${s.stats?.losses ?? 0}</td>
        <td>${percent(s.stats?.wr ?? 0)}</td>
        <td class="${cls(s.stats?.profit)}"><b>${money(s.stats?.profit ?? 0, cur, true)}</b></td>
        <td>${s.endedAt ? clock(s.endedAt) : '<span class="pill pos">ativa</span>'}</td>
      </tr>`;
    }).join('') : '<tr class="empty-row"><td colspan="9">sem sessões no período</td></tr>';
  }
}

/* ─── polling ────────────────────────────────────────────────────────────── */
async function refreshRuntime() {
  const res = await api('/api/runtime');
  if (!res.ok) { state.runtime = null; render(); return; }
  state.runtime = res.data;
  if (res.data?.stake) state.stake = res.data.stake;
}
async function refreshStats() {
  const res = await api('/api/stats');
  if (res.ok) state.stats = res.data;
}
async function refreshEngine() {
  const res = await api('/api/engine');
  if (res.ok) state.engine = res.data;
}
async function refreshEvents() {
  const res = await api('/api/events?limit=80');
  if (res.ok) renderEvents(res.data.events ?? []);
}

async function boot() {
  applyTheme(initialTheme(), { persist: false });
  await refreshRuntime();
  await Promise.all([refreshStats(), refreshEngine(), refreshAuthStatus()]);
  render();
  await refreshEvents();
  wsConnect(); // conecta WebSocket para atualização em tempo real

  setInterval(() => { void refreshRuntime().then(render).catch(() => {}); }, 2_000);
  setInterval(() => { void refreshStats().then(() => { renderHero(); renderStats(); }).catch(() => {}); }, 4_000);
  setInterval(() => { void refreshEvents().catch(() => {}); }, 5_000);
  setInterval(() => { void refreshEngine().then(renderEngineInfo).catch(() => {}); }, 30_000);
  setInterval(() => tickTimer(null), 1_000);

  // deep-link usado pelos screenshots/verificação: ?open=settings | ?open=history
  const open = new URLSearchParams(location.search).get('open');
  if (open === 'settings') $('settings').showModal();
  if (open === 'history') { $('history').showModal(); void renderHistory(); }
}

/* ─── eventos de UI ──────────────────────────────────────────────────────── */
$('power').addEventListener('click', () => void togglePower());
$('open-settings').addEventListener('click', () => { $('settings').showModal(); });
$('open-history').addEventListener('click', () => { $('history').showModal(); void renderHistory(); });
for (const btn of document.querySelectorAll('[data-theme-set]')) {
  btn.addEventListener('click', () => applyTheme(btn.dataset.themeSet));
}
for (const btn of document.querySelectorAll('[data-range]')) {
  btn.addEventListener('click', () => {
    state.history.range = btn.dataset.range;
    for (const other of document.querySelectorAll('[data-range]')) other.setAttribute('aria-checked', String(other === btn));
    void renderHistory();
  });
}
for (const btn of document.querySelectorAll('[data-tab]')) {
  btn.addEventListener('click', () => {
    state.history.tab = btn.dataset.tab;
    for (const other of document.querySelectorAll('[data-tab]')) other.setAttribute('aria-checked', String(other === btn));
    void renderHistory();
  });
}
const stakeInput = $('stake-input');
stakeInput.addEventListener('focus', () => { state.stakeEditing = true; });
stakeInput.addEventListener('blur', () => { state.stakeEditing = false; });
stakeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void saveStake(parseStakeInput(stakeInput.value)); } });
$('stake-save').addEventListener('click', () => void saveStake(parseStakeInput(stakeInput.value)));
$('settings-stake-save').addEventListener('click', () => void saveStake(parseStakeInput($('settings-stake').value), { fromSettings: true }));

/* ─── deletar contadores ──────────────────────────────────────────────────── */
async function deleteCounters() {
  const ok = await askConfirm({
    title: '⚠️ Deletar todos os contadores',
    text: 'Esta ação é irreversível. Todos os dados serão permanentemente apagados:\n\n• Histórico do dia, semana e mês\n• Contadores de operações, wins e losses\n• Percentual de acerto (WR)\n• Lucros registrados\n\nPara confirmar, digite: DELETAR TUDO',
    okLabel: 'DELETAR TUDO',
    requireText: 'DELETAR TUDO',
  });
  if (!ok) return;
  const res = await api('/api/reset', { method: 'POST', body: { confirm: 'DELETAR TUDO' } });
  if (!res.ok) {
    banner(res.data?.error ?? 'não foi possível deletar os contadores', 'error');
    return;
  }
  banner('✅ Contadores deletados com sucesso. Todos os dados foram resetados.');
  await Promise.all([refreshStats(), refreshRuntime()]);
  render();
}

$('btn-delete-counters').addEventListener('click', () => void deleteCounters());

// Login / account switch
$('btn-login')?.addEventListener('click', () => void doLogin());
$('btn-logout')?.addEventListener('click', () => void doLogout());
$('btn-account-demo')?.addEventListener('click', () => void switchAccount('demo'));
$('btn-account-real')?.addEventListener('click', () => void switchAccount('real'));

void boot();
