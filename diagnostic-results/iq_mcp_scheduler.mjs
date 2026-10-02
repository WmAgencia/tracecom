/**
 * AGENDADOR CENTRAL MCP — IQ OPTION (somente leitura).
 *
 * Motivo: o gateway MCP impõe um limite GLOBAL de 60 req/min por token,
 * compartilhado entre TODOS os 7 servidores (binary-options, turbo-options,
 * blitz-options, digital-options, marginal-forex, marginal-crypto, marginal-cfd).
 * Disparar coletores concorrentes estoura o limite e o servidor degrada
 * (passa a rejeitar mesmo depois de esperar). Este módulo serializa tudo.
 *
 * Garantias:
 *  - Token bucket global (padrão 55 req/min, abaixo do limite de 60).
 *  - Orçamento por servidor por execução (evita que um produto consuma tudo).
 *  - Tratamento de `retry_after_ms=<n>` (formato NÃO-JSON usado pelo gateway).
 *  - Backoff exponencial com jitter + circuit breaker por servidor.
 *  - Checkpoint persistente: retoma de onde parou após reinício do processo.
 *  - Allowlist de ferramentas SOMENTE LEITURA: place_trade/place_market_order
 *    e qualquer escrita são recusados em código antes de sair do processo.
 *
 * Uso como biblioteca:
 *   import { Scheduler } from "./iq_mcp_scheduler.mjs";
 *   const s = new Scheduler({ token: process.env.IQ_MCP_TOKEN });
 *   await s.start();
 *   const { data } = await s.call("binary-options", "get_candles", { asset_id: 1, size: 60, count: 1000 });
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Ferramentas permitidas: NENHUMA delas cria, altera ou encerra posição. */
export const READ_ONLY_TOOLS = Object.freeze(
  new Set([
    "get_capabilities",
    "get_limits",
    "get_candles",
    "get_prices",
    "get_instruments",
    "get_trade_history",
    "list_assets",
    "list_balances",
    "list_positions",
    "calculate_order_size",
  ]),
);

/** Ferramentas explicitamente proibidas — bloqueadas mesmo se o token permitir. */
export const FORBIDDEN_TOOLS = Object.freeze(
  new Set([
    "place_trade",
    "place_market_order",
    "place_limit_order",
    "place_stop_order",
    "sell_position",
    "close_position",
    "cancel_pending_order",
    "rollover_position",
    "change_position_stop_loss",
    "change_position_take_profit",
  ]),
);

export const SERVERS = Object.freeze([
  "binary-options",
  "turbo-options",
  "blitz-options",
  "digital-options",
  "marginal-forex",
  "marginal-crypto",
  "marginal-cfd",
]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

export class ForbiddenToolError extends Error {}
export class BudgetExceededError extends Error {}

const DEFAULT_CHECKPOINT = "diagnostic-results/data/iq-scheduler-checkpoint.json";

export class Scheduler {
  /**
   * @param {object} opts
   * @param {string} opts.token bearer do MCP
   * @param {number} [opts.rpm] requisições por minuto (padrão 55; limite real = 60)
   * @param {number} [opts.perServerBudget] orçamento por servidor nesta execução
   * @param {string} [opts.checkpoint] caminho do checkpoint persistente
   * @param {(m:string)=>void} [opts.log]
   */
  constructor(opts = {}) {
    this.token = opts.token ?? process.env.IQ_MCP_TOKEN;
    if (!this.token) throw new Error("Scheduler: token ausente (IQ_MCP_TOKEN)");
    this.rpm = opts.rpm ?? 55;
    // Espaçamento mínimo entre requisições: evita rajadas que disparam a penalidade
    // do gateway (a degradação observada ocorreu após um burst de inicializações).
    this.minGapMs = opts.minGapMs ?? 1500;
    this.lastRequestAt = 0;
    this.perServerBudget = opts.perServerBudget ?? 200;
    this.checkpointPath = opts.checkpoint ?? DEFAULT_CHECKPOINT;
    this.log = opts.log ?? ((m) => console.log(m));

    /** @type {{server:string,session:string|null,id:number,breaker:{fails:number,openUntil:number},used:number}[]} */
    this.state = new Map(SERVERS.map((s) => [s, { server: s, session: null, id: 0, breaker: { fails: 0, openUntil: 0 }, used: 0 }]));
    this.requestTimes = []; // janela deslizante global (ms)
    this.globalBlockedUntil = 0;
    this.history = { startedAtUtc: null, requests: 0, throttled: 0, circuitOpened: 0, errors: 0 };
    this.tasks = new Map(); // dedupe/checkpoint de tarefas concluídas
    this.#loadCheckpoint();
  }

  #loadCheckpoint() {
    try {
      if (!existsSync(this.checkpointPath)) return;
      const cp = JSON.parse(readFileSync(this.checkpointPath, "utf8"));
      for (const s of cp.servers ?? []) {
        const st = this.state.get(s.server);
        if (st) { st.id = s.id ?? 0; st.breaker = s.breaker ?? st.breaker; }
      }
      for (const t of cp.doneTasks ?? []) this.tasks.set(t, true);
      this.log(`[scheduler] checkpoint carregado: ${this.tasks.size} tarefas concluídas`);
    } catch (e) {
      this.log(`[scheduler] checkpoint ilegível (${String(e.message).slice(0, 80)}); iniciando limpo`);
    }
  }

  saveCheckpoint() {
    mkdirSync(dirname(this.checkpointPath), { recursive: true });
    writeFileSync(
      this.checkpointPath,
      JSON.stringify(
        {
          savedAtUtc: new Date().toISOString(),
          read_only: true,
          servers: [...this.state.values()].map((s) => ({ server: s.server, id: s.id, used: s.used, breaker: s.breaker })),
          doneTasks: [...this.tasks.keys()],
          history: this.history,
        },
        null,
        2,
      ),
    );
  }

  /** Tarefa já concluída? (checkpoint idempotente) */
  isDone(key) { return this.tasks.has(key); }
  markDone(key) { this.tasks.set(key, true); }

  /** Abre ou reutiliza a sessão MCP de um servidor (initialize + notifications/initialized). */
  async open(server) {
    if (!SERVERS.includes(server)) throw new Error(`servidor desconhecido: ${server}`);
    const st = this.state.get(server);
    if (st.session) return st;
    const url = `https://${server}.mcp.iqoption.com`;
    const res = await this.#post(url, {
      jsonrpc: "2.0",
      id: ++st.id,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "tracecon-oos", version: "0.1.0" } },
    }, st);
    if (res?.result === undefined && res?.error) throw new Error(`initialize ${server}: ${JSON.stringify(res.error).slice(0, 200)}`);
    await this.#post(url, { jsonrpc: "2.0", method: "notifications/initialized" }, st, true);
    return st;
  }

  /** Chama uma ferramenta READ-ONLY. Lança ForbiddenToolError para qualquer escrita. */
  async call(server, tool, args = {}) {
    if (FORBIDDEN_TOOLS.has(tool)) throw new ForbiddenToolError(`ferramenta de escrita bloqueada: ${tool}`);
    if (!READ_ONLY_TOOLS.has(tool)) throw new ForbiddenToolError(`ferramenta fora da allowlist de leitura: ${tool}`);
    const st = await this.open(server);
    const stt = this.state.get(server);
    if (stt.used >= this.perServerBudget) throw new BudgetExceededError(`${server}: orçamento de ${this.perServerBudget} requisições esgotado nesta execução`);
    const res = await this.#post(
      `https://${server}.mcp.iqoption.com`,
      { jsonrpc: "2.0", id: ++st.id, method: "tools/call", params: { name: tool, arguments: args } },
      st,
    );
    stt.used++;
    if (res?.result?.isError) {
      const txt = JSON.stringify(res.result.content ?? {}).slice(0, 200);
      throw new Error(`tool ${tool} @${server} erro: ${txt}`);
    }
    const txt = res?.result?.content?.find?.((c) => c.type === "text")?.text;
    if (txt === undefined) return { raw: res?.result?.structuredContent ?? null };
    let data;
    try { data = JSON.parse(txt); } catch { data = { text: txt }; }
    return { data, result: res.result };
  }

  /** Respeita o token bucket global + janela bloqueada. */
  async #gate(server) {
    const st = this.state.get(server);
    for (;;) {
      const t = now();
      if (t < this.globalBlockedUntil) { await sleep(this.globalBlockedUntil - t + 250); continue; }
      if (t < st.breaker.openUntil) { await sleep(st.breaker.openUntil - t + 250); continue; }
      this.requestTimes = this.requestTimes.filter((x) => t - x < 60_000);
      const gapOk = t - this.lastRequestAt >= this.minGapMs;
      if (this.requestTimes.length < this.rpm && gapOk) {
        this.requestTimes.push(t);
        this.lastRequestAt = t;
        return;
      }
      const wait = gapOk ? 60_000 - (t - this.requestTimes[0]) + 120 : this.minGapMs - (t - this.lastRequestAt);
      this.history.throttled++;
      await sleep(Math.max(250, wait));
    }
  }

  async #post(url, body, st, notification = false) {
    const MAX_TRIES = 6;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      await this.#gate(st.server);
      let res;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            ...(st.session ? { "mcp-session-id": st.session } : {}),
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        this.history.errors++;
        await this.#backoff(st, attempt, `rede: ${String(e.message).slice(0, 80)}`);
        continue;
      }
      this.history.requests++;
      const sid = res.headers.get("mcp-session-id");
      if (sid) st.session = sid;

      if (res.status === 429 || res.headers.get("retry-after")) {
        const secs = Number(res.headers.get("retry-after"));
        const waitMs = Number.isFinite(secs) && secs > 0 ? secs * 1000 : 61_000;
        this.globalBlockedUntil = now() + waitMs;
        this.log(`  [rate] HTTP 429 @${st.server}; pausa global ${Math.round(waitMs / 1000)}s (tentativa ${attempt})`);
        await sleep(waitMs + 500);
        this.requestTimes = [];
        continue;
      }
      if (!res.ok && res.status !== 202) {
        this.history.errors++;
        await this.#backoff(st, attempt, `HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      if (!text.trim()) { st.breaker.fails = 0; this.#onSuccess(); return notification ? null : { result: undefined }; }
      const lines = text.split("\n").filter((l) => l.startsWith("data:"));
      let payload;
      try {
        payload = lines.length ? JSON.parse(lines.map((l) => l.slice(5)).at(-1)) : JSON.parse(text);
      } catch (e) {
        this.history.errors++;
        await this.#backoff(st, attempt, `resposta ilegível: ${String(e.message).slice(0, 80)}`);
        continue;
      }
      // Limite devolvido como corpo de erro: retry_after_ms=<ms> (formato =, não JSON)
      const asText = JSON.stringify(payload?.error ?? "");
      const m = asText.match(/retry_after_ms=(\d+)/);
      const r = asText.match(/reset_at=(\d{10,13})/);
      if (payload?.error && (m || r)) {
        const retryMs = m ? Number(m[1]) : 61_000;
        const resetMs = r ? (r[1].length === 10 ? Number(r[1]) * 1000 : Number(r[1])) - now() : 0;
        const waitMs = Math.max(retryMs, resetMs) + 1000; // `reset_at` é a fonte mais precisa
        this.globalBlockedUntil = now() + waitMs;
        this.log(`  [rate] RPC @${st.server}; pausa global ${Math.round(waitMs / 1000)}s (tentativa ${attempt})`);
        await sleep(waitMs);
        this.requestTimes = [];
        continue;
      }
      st.breaker.fails = 0;
      this.#onSuccess();
      return notification ? null : payload;
    }
    throw new Error(`#post: ${MAX_TRIES} tentativas falharam para ${st.server}`);
  }

  #onSuccess() {
    // Sucesso zera o contador de falhas de todos os servidores: o limite é global,
    // então uma rejeição não deve penalizar apenas o servidor que a recebeu.
    for (const s of this.state.values()) if (s.breaker.fails > 0) { s.breaker.fails = 0; s.breaker.openUntil = 0; }
  }

  /** Backoff exponencial com jitter + circuit breaker. */
  async #backoff(st, attempt, why) {
    st.breaker.fails++;
    const base = Math.min(60_000, 1000 * 2 ** (attempt - 1));
    const jitter = Math.floor(Math.random() * 750);
    if (st.breaker.fails >= 4) {
      const openMs = Math.min(15 * 60_000, 60_000 * 2 ** (st.breaker.fails - 4));
      st.breaker.openUntil = now() + openMs;
      this.history.circuitOpened++;
      this.log(`  [breaker] ${st.server} ABERTO por ${Math.round(openMs / 1000)}s após ${st.breaker.fails} falhas (${why})`);
    } else {
      this.log(`  [retry] ${st.server} ${why}; aguardando ${base + jitter}ms (tentativa ${attempt})`);
    }
    await sleep(base + jitter);
  }

  /** Inicializa todas as sessões em sequência (sem concorrência). */
  async start() {
    this.history.startedAtUtc = new Date().toISOString();
    for (const s of SERVERS) {
      try {
        await this.open(s);
        this.log(`[scheduler] sessão aberta: ${s}`);
      } catch (e) {
        this.log(`[scheduler] falha ao abrir ${s}: ${String(e.message).slice(0, 120)}`);
      }
    }
    return this;
  }

  report() {
    return {
      ...this.history,
      servers: [...this.state.values()].map((s) => ({ server: s.server, requests: s.used, breakerOpen: s.breaker.openUntil > now() })),
      doneTasks: this.tasks.size,
      rpm: this.rpm,
    };
  }
}

/**
 * Deduplica ativos por `asset_id` entre produtos.
 * Os totais por produto (91 + 51 + 74 + 67) NÃO são ativos únicos: o mesmo
 * subjacente aparece em vários produtos (ex.: EUR/USD em binary e turbo).
 */
export function dedupeAssets(assetsByProduct) {
  /** @type {Map<number|string, any>} */
  const byId = new Map();
  for (const [product, assets] of Object.entries(assetsByProduct)) {
    for (const a of assets ?? []) {
      const id = a.asset_id ?? a.id ?? a.instrument_id;
      if (id === undefined || id === null) continue;
      const cur = byId.get(id) ?? { asset_id: id, names: new Set(), isOpen: false, raw: a, byProduct: {} };
      cur.names.add(a.name ?? a.description ?? a.symbol ?? String(id));
      // Dois esquemas distintos no gateway:
      //  - binary/turbo: `expirations` = timestamps absolutos (unix s) de vencimento;
      //  - blitz/digital: `expiration_sizes_seconds` = DURAÇÕES ofertadas em segundos
      //    (ex.: [30,45,60,120,180,300]) — é aqui que 300s aparece explicitamente.
      const exps = [];
      const sizes = [];
      for (const k of ["expiration", "expirations", "expiry", "duration"]) {
        const v = a[k];
        if (typeof v === "number") exps.push(v);
        else if (Array.isArray(v)) for (const x of v) if (typeof x === "number") exps.push(x);
      }
      for (const k of ["expiration_sizes_seconds", "expirationSizesSeconds", "expiration_sizes", "durations"]) {
        const v = a[k];
        if (typeof v === "number") sizes.push(v);
        else if (Array.isArray(v)) for (const x of v) if (typeof x === "number") sizes.push(x);
      }
      exps.sort((x, y) => x - y);
      // Binary/turbo/blitz expõem o payout como `profit_percent` (ex.: 91 = 91%).
      const p = a.profit_percent ?? a.profitPercent ?? a.payout ?? a.payout_percent ?? a.payoutPercent ?? a.profit ?? a.commission;
      const payout = typeof p === "number" && p > 0 ? (p <= 1 ? Math.round(p * 10000) / 100 : p) : null;
      const steps = [...new Set(exps.slice(1).map((e, i) => e - exps[i]))].sort((x, y) => x - y);
      cur.byProduct[product] = {
        payout,
        expirations: exps,
        expiration_steps_s: steps,
        expiration_sizes_s: [...new Set(sizes)].sort((x, y) => x - y),
        supports_300s: [...new Set(sizes)].includes(300) || [...new Set(steps)].includes(60),
        is_open: a.is_open === true || a.isOpen === true,
        raw: a,
      };
      if (a.is_open === true || a.isOpen === true) cur.isOpen = true;
      byId.set(id, cur);
    }
  }
  return [...byId.values()]
    .map((v) => {
      const products = Object.keys(v.byProduct).sort();
      // `payout` agregado = MAIOR payout entre produtos NO MOMENTO (não é o payout de execução);
      // o payout que vale para uma operação é `byProduct[<produto>].payout`.
      const payouts = products.map((p) => v.byProduct[p].payout).filter((x) => typeof x === "number");
      return {
        asset_id: v.asset_id,
        name: v.raw.name ?? v.raw.description ?? [...v.names][0],
        products,
        n_products: products.length,
        byProduct: Object.fromEntries(products.map((p) => [p, {
          payout: v.byProduct[p].payout,
          expirations: v.byProduct[p].expirations,
          expiration_steps_s: v.byProduct[p].expiration_steps_s,
          expiration_sizes_s: v.byProduct[p].expiration_sizes_s,
          supports_300s: v.byProduct[p].supports_300s,
          is_open: v.byProduct[p].is_open,
        }])),
        payout: payouts.length ? Math.max(...payouts) : null,
        payoutByProduct: Object.fromEntries(products.map((p) => [p, v.byProduct[p].payout])),
        expirations: [...new Set(products.flatMap((p) => v.byProduct[p].expirations))].sort((a, b) => a - b),
        is_open: v.isOpen,
        raw: v.raw,
      };
    })
    .sort((a, b) => b.n_products - a.n_products || String(a.name).localeCompare(String(b.name)));
}

export const checkpointPathDefault = DEFAULT_CHECKPOINT;
export { join };
