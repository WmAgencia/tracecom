/**
 * FORWARD PAPER EVALUATOR — métricas prospectivas dos ledgers hash-chained.
 *
 * Métricas por experimento (H5 / H1):
 *  - amostra bruta e EFETIVA (ESS: trades não sobrepostos no mesmo sentido;
 *    ajuste adicional por blocos no bootstrap)
 *  - WR com IC 95% por block bootstrap (bloco = 12 candles = 1h, respeita
 *    dependência temporal de trades sobrepostos/adjacentes)
 *  - EV líquido por trade: binário (payout 0.85, custos 2×0.1%) e spot
 *  - drawdown máximo da curva de EV acumulado
 *  - cobertura: % dos candles de sinal que geraram operação
 *  - baseline: direção aleatória com o mesmo modelo de custo
 *  - verificação da hash-chain (imutabilidade)
 *
 * Uso: npx tsx forward-paper/evaluate.mts
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const HORIZONS = ["TRACECON-WF-ETHUSDT-5M-BB20-H5", "TRACECON-WF-ETHUSDT-5M-BB20-H1"];
const PAYOUT = 0.85, FEE_LEG = 0.001;
const BLOCK = 12; // candles de 5m num bloco de 1h

interface Rec { ts_utc: string; strategy_id: string; trade_id?: number; direction?: string; signal_close?: number; entry_px_executable?: number; settle_px?: number; hit?: boolean; spot_net_return?: number; slippage_bps?: number; overlapping_same_direction?: number; status?: string; prev_hash?: string; hash: string; }
function loadLedger(file: string): Rec[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as Rec);
}
function verifyChain(recs: Rec[]): boolean {
  let prev = "GENESIS";
  for (const r of recs) {
    const { hash, ...rest } = r;
    const expected = createHash("sha256").update(prev + JSON.stringify(rest)).digest("hex");
    if (expected !== hash) return false;
    prev = hash;
  }
  return true;
}
function blockBootstrapWR(trades: Array<{ hit: boolean; ts: number }>, iters = 5000): { wr: number; lo: number; hi: number } {
  if (trades.length === 0) return { wr: NaN, lo: NaN, hi: NaN };
  const wr = trades.filter((t) => t.hit).length / trades.length;
  const estimates: number[] = [];
  for (let it = 0; it < iters; it++) {
    let wins = 0, total = 0;
    while (total < trades.length) {
      const start = Math.floor(Math.random() * trades.length);
      for (let b = 0; b < BLOCK && total < trades.length; b++) {
        const t = trades[(start + b) % trades.length]!;
        if (t.hit) wins++;
        total++;
      }
    }
    estimates.push(wins / total);
  }
  estimates.sort((a, b) => a - b);
  return { wr, lo: estimates[Math.floor(0.025 * iters)]!, hi: estimates[Math.ceil(0.975 * iters) - 1]! };
}
function maxDrawdown(ev: number[]): number {
  let peak = 0, dd = 0;
  for (const x of ev) { peak = Math.max(peak, x); dd = Math.max(dd, peak - x); }
  return dd;
}
function essFromOverlaps(trades: Rec[]): number {
  // ESS conservador: subtrai duplicatas por sobreposição no mesmo sentido
  let ess = 0;
  for (const t of trades) {
    const overlap = t.overlapping_same_direction ?? 0;
    ess += 1 / (1 + overlap);
  }
  return Math.max(1, Math.round(ess));
}

for (const sid of HORIZONS) {
  const recs = loadLedger(`forward-paper/signals/${sid}.jsonl`);
  const signals = recs.filter((r) => r.status === "open");
  const settles = recs.filter((r) => r.status === "settled");
  const chainOk = verifyChain(recs);
  console.log(`\n=== ${sid} ===`);
  console.log(`registros: ${recs.length} (sinais ${signals.length}, liquidadas ${settles.length}) | hash-chain íntegra: ${chainOk}`);
  if (settles.length === 0) { console.log("amostra prospectiva ainda vazia — nada a declarar (correto nesta fase)"); continue; }

  const trades = settles.map((r) => ({ hit: r.hit!, ts: new Date(r.ts_utc).getTime(), evBin: r.binary_net_return_payout85!, evSpot: r.spot_net_return!, slip: r.slippage_bps ?? 0 }));
  const wr = blockBootstrapWR(trades);
  const evBin = trades.reduce((s, t) => s + t.evBin, 0) / trades.length;
  const evSpot = trades.reduce((s, t) => s + t.evSpot, 0) / trades.length;
  const avgSlip = trades.reduce((s, t) => s + t.slip, 0) / trades.length;
  const curve: number[] = [];
  let acc = 0;
  for (const t of trades) { acc += t.evBin; curve.push(acc); }
  const dd = maxDrawdown(curve);
  const ess = essFromOverlaps(settles);
  const rnd = trades.length ? (0.5 * PAYOUT - 0.5) - 2 * FEE_LEG : NaN; // EV binário do aleatório

  console.log(`ops liquidadas: ${trades.length} | ESS (sobreposição): ${ess}`);
  console.log(`WR: ${(wr.wr * 100).toFixed(1)}%  IC95 block-bootstrap [${(wr.lo * 100).toFixed(1)}%, ${(wr.hi * 100).toFixed(1)}%]`);
  console.log(`EV binário/trade (payout 85%, custos 2×0.1%): ${(evBin * 100).toFixed(2)}% | EV spot/trade: ${(evSpot * 100).toFixed(3)}% | baseline aleatório EV: ${(rnd * 100).toFixed(2)}%`);
  console.log(`slippage médio: ${avgSlip.toFixed(1)} bps | max drawdown (EV acumulado): ${(dd * 100).toFixed(1)} p.p.`);
  console.log(`cobertura: ${signals.length} sinais emitidos`);
  console.log(`VEREDITO PROSPECTIVO: ${wr.lo > 0.558 && evBin > 0 && ess >= 100 ? "elegível (IC-lower acima do breakeven 55.8% e EV>0, ESS>=100)" : "NÃO APROVADO ainda"}`);
}
