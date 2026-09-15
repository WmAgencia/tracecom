import pg from "pg";
import fs from "node:fs";
const { Client } = pg;
const OUT = process.env.OUT_DIR || ".";
const STRATS = { A: "reversion-v1-fib", B: "reversion-v3-fib", C: "reversion-v2-fib", D: "stochrsi-v1" };
const wilson = (w, n) => { if (!n) return null; const z = 1.96, p = w / n, d = 1 + z * z / n, cc = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [+(Math.max(0, cc - h)).toFixed(4), +Math.min(1, cc + h).toFixed(4)]; };
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const run = (await c.query("SELECT * FROM fwd_event_runs ORDER BY started_at ASC LIMIT 1")).rows[0];
  const all = (await c.query("SELECT * FROM fwd_events WHERE run_id=$1 AND price_t60 IS NOT NULL AND price_t45 IS NOT NULL AND (created_ms - t0_ms) < 45000 ORDER BY t0_ms ASC LIMIT 100", [run.run_id])).rows;
  const excluded = (await c.query("SELECT COUNT(*)::int n FROM fwd_events WHERE run_id=$1 AND price_t60 IS NOT NULL AND (created_ms - t0_ms) >= 45000", [run.run_id])).rows[0].n;
  console.log(`run=${run.run_id} cohortStart=${new Date(Number(run.start_ms)).toISOString()} resolvedEvents=${all.length}/100 excludedNonLive=${excluded} closed=${run.closed}`);
  const table = [];
  for (const key of ["A", "B", "C", "D"]) {
    for (const h of [45, 60]) {
      const dcol = `${key.toLowerCase()}_decision`, rcol = `${key.toLowerCase()}_${h}`;
      const buys = all.filter((e) => e[dcol] === "BUY").length;
      const sells = all.filter((e) => e[dcol] === "SELL").length;
      const waits = all.filter((e) => e[dcol] === "WAIT").length;
      const results = all.filter((e) => e[dcol] !== "WAIT").map((e) => e[rcol]).filter(Boolean);
      const w = results.filter((r) => r === "WIN").length, l = results.filter((r) => r === "LOSS").length, d = results.filter((r) => r === "DRAW").length, u = results.filter((r) => r === "UNKNOWN").length;
      const dirN = w + l;
      table.push({ strategy: key, version: STRATS[key], horizon: h, events: all.length, buy: buys, sell: sells, wait: waits, w, l, d, u, directionalN: dirN, wr: dirN ? +((w / dirN) * 100).toFixed(1) : null, wilson95: wilson(w, dirN), coverage: all.length ? +(((buys + sells) / all.length) * 100).toFixed(1) : null, wBuy: results.length ? buys : buys, wBuyW: all.filter((e) => e[dcol] === "BUY" && e[rcol] === "WIN").length, wBuyL: all.filter((e) => e[dcol] === "BUY" && e[rcol] === "LOSS").length, wSellW: all.filter((e) => e[dcol] === "SELL" && e[rcol] === "WIN").length, wSellL: all.filter((e) => e[dcol] === "SELL" && e[rcol] === "LOSS").length });
    }
  }
  for (const t of table) console.log(`${t.strategy}@${t.horizon} | BUY=${t.buy} SELL=${t.sell} WAIT=${t.wait} | W=${t.w} L=${t.l} D=${t.d} U=${t.u} | dirN=${t.directionalN} WR=${t.wr}% Wilson=${t.wilson95 ? t.wilson95.join("..") : "-"} | cobertura=${t.coverage}% | BUY ${t.wBuyW}W/${t.wBuyL}L SELL ${t.wSellW}W/${t.wSellL}L`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/events100-summary.json`, JSON.stringify({ run, resolved: all.length, table }, null, 1));
  const lines = ["event_id,t0_iso,entry_price,A,B,C,D,price_t45,price_t60,A_45,A_60,B_45,B_60,C_45,C_60,D_45,D_60"];
  const res = (dec, r) => (dec === "WAIT" ? "" : (r ?? ""));
  for (const e of all) lines.push([e.event_id, new Date(Number(e.t0_ms)).toISOString(), e.entry_price, e.a_decision, e.b_decision, e.c_decision, e.d_decision, e.price_t45, e.price_t60, res(e.a_decision, e.a_45), res(e.a_decision, e.a_60), res(e.b_decision, e.b_45), res(e.b_decision, e.b_60), res(e.c_decision, e.c_45), res(e.c_decision, e.c_60), res(e.d_decision, e.d_45), res(e.d_decision, e.d_60)].join(","));
  fs.writeFileSync(`${OUT}/events100-listing.csv`, lines.join("\n"));
  console.log("files written: events100-summary.json, events100-listing.csv");
  await c.end();
})().catch((e) => { console.error("ERR " + (e && e.stack || e && e.message)); process.exit(1); });