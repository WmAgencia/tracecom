/**
 * RELATORIO EXPERIMENTAL — CONSENSUS vs V2 central (somente leitura).
 * Mede: WR, PnL, frequencia, quantidade de WAIT, qualidade (contra-evidencia), latencia.
 * Uso: node scripts/consensus-report.mjs [horas=6]
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../relay/package.json", import.meta.url));
const pg = require("pg");

const hours = Math.max(1, Math.min(72, Number(process.argv[2]) || 6));
const pool = new pg.Pool({ connectionString: "postgresql://postgres.cladmauwmuoeqongxzwb:Eqvpanp.050323@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=no-verify", max: 2, ssl: { rejectUnauthorized: false } });
const n2 = (v) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(2)) : null);
const pct = (part, total) => (total > 0 ? n2((100 * part) / total) + "%" : "n/a");

try {
  const since = new Date(Date.now() - hours * 3600_000);
  const decisions = (await pool.query("SELECT decision, side, count(*)::int AS n FROM iq_consensus_decisions WHERE at > $1 GROUP BY 1,2 ORDER BY n DESC", [since])).rows;
  const totalDec = decisions.reduce((acc, r) => acc + r.n, 0);
  const waits = decisions.filter((r) => r.decision === "WAIT").reduce((acc, r) => acc + r.n, 0);
  const approvals = totalDec - waits;
  const latency = (await pool.query("SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50, percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95 FROM iq_consensus_decisions WHERE at > $1", [since])).rows[0];
  const counterTop = (await pool.query("SELECT item->>'code' AS code, count(*)::int AS n FROM iq_consensus_decisions, jsonb_array_elements(counter) AS item WHERE at > $1 GROUP BY 1 ORDER BY n DESC LIMIT 8", [since])).rows;
  const opps = (await pool.query("SELECT count(DISTINCT market_key)::int AS markets, count(*)::int AS rows FROM iq_consensus_decisions WHERE at > $1 AND rsi_state IS NOT NULL AND rsi_state <> 'NEUTRAL'", [since])).rows[0];

  const execs = (await pool.query(
    `SELECT coalesce(meta->>'source', '?') AS source, count(*)::int AS n,
            count(*) FILTER (WHERE broker_result = 'WIN')::int AS wins,
            count(*) FILTER (WHERE broker_result = 'LOSS')::int AS losses,
            count(*) FILTER (WHERE broker_result = 'DRAW')::int AS draws,
            count(*) FILTER (WHERE state IN ('REQUESTED','ACKNOWLEDGED'))::int AS open,
            coalesce(sum(profit), 0)::numeric AS pnl
     FROM iq_executions WHERE requested_at > $1 GROUP BY 1 ORDER BY n DESC`, [since])).rows;

  const v2 = (await pool.query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE result = 'win')::int AS wins, count(*) FILTER (WHERE result = 'loss')::int AS losses, coalesce(sum(profit), 0)::numeric AS pnl
     FROM iq_rsi_opportunities_v2live WHERE accepted = true AND submit_at > $1`, [Date.now() - hours * 3600_000])).rows[0];

  const lines = [];
  lines.push(`# Relatorio experimental CONSENSUS — ultimas ${hours}h`);
  lines.push("");
  lines.push("## Consensus (nova arquitetura)");
  lines.push(`- Decisoes persistidas: **${totalDec}** · WAIT: **${waits}** (${pct(waits, totalDec)}) · aprovacoes (BUY/SELL): **${approvals}**`);
  lines.push(`- Mercados com oportunidade RSI (73/28): **${opps?.markets ?? 0}** (linhas com estado de extremo: ${opps?.rows ?? 0})`);
  lines.push(`- Latencia por avaliacao: p50 **${latency?.p50 ?? "-"}ms** · p95 **${latency?.p95 ?? "-"}ms**`);
  lines.push(`- Distribuicao: ${decisions.map((r) => `${r.decision}${r.side ? " " + r.side : ""}=${r.n}`).join(" · ") || "sem dados"}`);
  lines.push(`- Top contra-evidencias: ${counterTop.map((r) => `${r.code}=${r.n}`).join(" · ") || "nenhuma"}`);
  lines.push("");
  lines.push("## Execucoes (por fonte)");
  for (const e of execs) {
    const settled = e.wins + e.losses + e.draws;
    lines.push(`- **${e.source}**: n=${e.n} · W=${e.wins} L=${e.losses} D=${e.draws} abertas=${e.open} · WR=${pct(e.wins, settled)} · PnL=${n2(e.pnl)}`);
  }
  if (!execs.length) lines.push("- (nenhuma execucao na janela)");
  lines.push("");
  lines.push("## Baseline V2 central (oportunidades aceitas)");
  lines.push(`- n=${v2?.n ?? 0} · W=${v2?.wins ?? 0} L=${v2?.losses ?? 0} · WR=${pct(v2?.wins ?? 0, (v2?.wins ?? 0) + (v2?.losses ?? 0))} · PnL=${n2(v2?.pnl)}`);
  lines.push("");
  lines.push("> Amostra pequena nao prova edge. Instrumentacao apenas descritiva (evidenceStrength NAO e probabilidade).");
  const md = lines.join("\n");
  fs.mkdirSync("docs/restructure", { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  fs.writeFileSync(`docs/restructure/consensus-report-${stamp}.md`, md);
  console.log(md);
  console.log("\nREPORT_WRITTEN docs/restructure/consensus-report-" + stamp + ".md");
} catch (error) {
  console.error("REPORT_FAIL", String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
