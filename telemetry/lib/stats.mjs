/**
 * ESTATÍSTICAS (funções puras) — dia / semana / mês, com DRAW fora do WR.
 * WR = wins / (wins + losses) * 100 — igual à convenção do motor.
 * Semana começa na SEGUNDA (padrão brasileiro). Fuso = o da máquina que roda o painel.
 */

export const RANGES = ['day', 'week', 'month', 'all'];

export function classifyOutcome(profit) {
  const p = Number(profit);
  if (!Number.isFinite(p) || p === 0) return 'draw';
  return p > 0 ? 'win' : 'loss';
}

export function tradeTime(trade) {
  const iso = trade?.settledAt ?? trade?.sentAt ?? null;
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
}

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export function startOfWeek(d) {
  const x = new Date(startOfDay(d));
  const dow = (x.getDay() + 6) % 7;      // 0 = segunda
  x.setDate(x.getDate() - dow);
  return x.getTime();
}

export function startOfMonth(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(1);
  return x.getTime();
}

export function rangeStart(range, now = Date.now()) {
  if (range === 'day') return startOfDay(now);
  if (range === 'week') return startOfWeek(now);
  if (range === 'month') return startOfMonth(now);
  return 0;
}

export function inRange(trade, range, now = Date.now()) {
  const t = tradeTime(trade);
  if (t === null) return false;
  return t >= rangeStart(range, now) && t <= now;
}

export function wr(wins, losses) {
  const total = Number(wins) + Number(losses);
  if (!(total > 0)) return 0;
  return Math.round((Number(wins) / total) * 10_000) / 100;
}

const empty = () => ({
  ops: 0, wins: 0, losses: 0, draws: 0, earlySells: 0,
  profit: 0, stake: 0, wr: 0, firstAt: null, lastAt: null,
});

const OUTCOMES = new Set(['win', 'loss', 'draw']);

/** O rótulo do bot (`win|loss|draw|early`) não manda no painel: quem decide é o SINAL do lucro. */
export function outcomeOf(trade) {
  const profit = Number(trade?.profit);
  const declared = trade?.outcome;
  return OUTCOMES.has(declared) ? declared : classifyOutcome(profit);
}

export function summarize(trades = []) {
  const out = empty();
  for (const trade of trades) {
    const profit = Number(trade?.profit);
    if (!Number.isFinite(profit)) continue;
    const outcome = outcomeOf(trade);
    out.ops++;
    if (outcome === 'win') out.wins++;
    else if (outcome === 'loss') out.losses++;
    else out.draws++;
    if (trade.earlySell) out.earlySells++;
    out.profit += profit;
    out.stake += Number(trade.stake) || 0;
    const t = tradeTime(trade);
    if (t !== null) {
      if (out.firstAt === null || t < Date.parse(out.firstAt)) out.firstAt = new Date(t).toISOString();
      if (out.lastAt === null || t > Date.parse(out.lastAt)) out.lastAt = new Date(t).toISOString();
    }
  }
  out.profit = Math.round(out.profit * 100) / 100;
  out.stake = Math.round(out.stake * 100) / 100;
  out.wr = wr(out.wins, out.losses);
  return out;
}

/** Totais por período + total geral. `now` injetável para teste. */
export function aggregate(trades = [], now = Date.now()) {
  const ranges = {};
  for (const range of RANGES) {
    const slice = range === 'all' ? trades.slice() : trades.filter((t) => inRange(t, range, now));
    ranges[range] = summarize(slice);
  }
  return {
    now: new Date(now).toISOString(),
    from: {
      day: new Date(rangeStart('day', now)).toISOString(),
      week: new Date(rangeStart('week', now)).toISOString(),
      month: new Date(rangeStart('month', now)).toISOString(),
    },
    ranges,
  };
}
