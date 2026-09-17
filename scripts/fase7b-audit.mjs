/** Auditoria Fase 7B: catalogo real x universo x runtime x office. */
import fs from "node:fs";
import * as universe from "../relay/market-universe.mjs";
import * as resolver from "../relay/asset-resolver.mjs";

const cat = JSON.parse(fs.readFileSync("iq-catalog.json", "utf8"));
const rows = [];
for (const r of cat.catalog) { const { canonical, otc } = resolver.canonicalFromName(r.name); if (!canonical) continue; rows.push({ ...r, canonical, marketType: otc ? "OTC" : "NORMAL" }); }
const office = await (await fetch("https://tracecom.consecom.com.br/api/iq/office", { signal: AbortSignal.timeout(30000) })).json();
const officeByKey = new Map(office.markets.map((m) => [m.marketKey, m]));
const table = universe.UNIVERSE.map((e) => {
  const key = universe.marketKey(e.canonical, e.marketType);
  const ms = rows.filter((r) => r.canonical === e.canonical && r.marketType === e.marketType);
  const best = ms.find((r) => r.enabled && !r.suspended) ?? ms[0] ?? null;
  const rt = officeByKey.get(key) ?? {};
  return { key, display: e.display, iq: best?.name ?? null, id: best?.id ?? null, status: best ? (best.enabled && !best.suspended ? "OPEN" : best.suspended ? "SUSPENDED" : "DISABLED") : "NOT_OFFERED", payout: best?.payout ?? null, rtStatus: rt.availability ?? null, enabled: rt.enabled === true, agent: rt.agentState ?? null, station: Boolean(rt) };
});
const counts = table.reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
console.log("AUDIT55", JSON.stringify(counts));
console.log("runtime enabled=" + office.markets.filter((m) => m.enabled).length + " open=" + office.markets.filter((m) => m.enabled && m.availability === "OPEN").length + " limit=" + office.activeLimit + " stake=" + office.config.defaultStake + " armed=" + office.aux.executionGate.armed + " mode=" + office.mode);
const mism = table.filter((r) => r.status !== r.rtStatus);
console.log("mismatches:", mism.length ? mism.map((r) => r.key + ":" + r.status + "!=" + r.rtStatus).join(", ") : "none");
for (const r of table) console.log([r.key, r.iq, r.id, r.status, r.payout, (r.enabled ? "ENABLED" : "off"), r.agent].join(" | "));
fs.writeFileSync("fase7b-audit.json", JSON.stringify({ at: new Date().toISOString(), counts, table }, null, 1), "utf8");
