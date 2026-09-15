const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [+(Math.max(0, cc - h)).toFixed(3), +Math.min(1, cc + h).toFixed(3)]; };
(async () => {
  await c.connect();
  const run = (await c.query("SELECT * FROM fwd_profile_runs ORDER BY started_at DESC LIMIT 1")).rows[0];
  const today = new Date().toISOString().slice(0, 10);
  const totalEvents = (await c.query("SELECT COUNT(*)::int n FROM fwd_profile_events WHERE run_id=$1", [run.run_id])).rows[0].n;
  const strat = (await c.query("SELECT strategy_version, decision, result_45, result_60, settled_ms FROM fwd_profile_decisions WHERE run_id=$1", [run.run_id])).rows;
  const names = [...new Set(strat.map((x) => x.strategy_version))];
  console.log(`run=${run.run_id} cohortStart=${new Date(Number(run.start_ms)).toISOString()} events=${totalEvents}`);
  console.log("\n=== HOJE (UTC " + today + ") ===");
  console.log("estratégia | sinais hoje | W | L | D | WR | cobertura");
  for (const s of names) {
    const rows = strat.filter((x) => x.strategy_version === s && x.settled_ms && new Date(Number(x.settled_ms)).toISOString().slice(0, 10) === today);
    const sig = rows.filter((x) => x.decision !== "WAIT");
    const w = sig.filter((x) => x.result_60 === "WIN").length, l = sig.filter((x) => x.result_60 === "LOSS").length, d = sig.filter((x) => x.result_60 === "DRAW").length;
    const n = w + l;
    console.log(`${s.replace("reversion-", "")} | ${sig.length} | ${w} | ${l} | ${d} | ${n ? ((w / n) * 100).toFixed(1) : "-"}% | ${totalEvents ? ((sig.length / totalEvents) * 100).toFixed(2) : "-"}%`);
  }
  console.log("\n=== COORTE ACUMULADA ===");
  console.log("estratégia | N sinais | W | L | D | WR | cobertura | Wilson 95%");
  for (const s of names) {
    const sig = strat.filter((x) => x.strategy_version === s && x.decision !== "WAIT");
    const w = sig.filter((x) => x.result_60 === "WIN").length, l = sig.filter((x) => x.result_60 === "LOSS").length, d = sig.filter((x) => x.result_60 === "DRAW").length;
    const n = w + l;
    console.log(`${s.replace("reversion-", "")} | ${sig.length} | ${w} | ${l} | ${d} | ${n ? ((w / n) * 100).toFixed(1) : "-"}% | ${totalEvents ? ((sig.length / totalEvents) * 100).toFixed(2) : "-"}% | ${wilson(w, n) ? wilson(w, n).join("..") : "-"}`);
  }
  console.log("\n=== DISCOVERY (histórico congelado — separado, NÃO somar ao forward) ===");
  console.log("v1-fib: 21/7/5 WR 75.0% n=28 Wilson 0.566-0.873 cov 1.43% | v3-fib: 35/18/0 WR 66.0% n=53 0.526-0.773 cov 2.20%");
  console.log("v6-fib: 4/0/0 WR 100% n=4 0.510-1 cov 0.19% (N insuficiente) | v7-and: 13/0/5 WR 100% n=13 0.772-1 cov 0.73% (N insuficiente)");
  console.log("v7-relaxed: 89/50/13 WR 64.0% n=139 0.558-0.715 cov 6.40%");
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.message)); process.exit(1); });