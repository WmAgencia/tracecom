/**
 * COLETOR DE CANDLES via MCP — IQ OPTION (somente leitura).
 *
 * Reescreve o coletor original sobre o AGENDADOR CENTRAL, resolvendo os três
 * defeitos que contaminaram a primeira coleta:
 *
 *  1. DUPLICAÇÃO — o original fazia append das janelas do MCP sem deduplicar,
 *     produzindo ~80% de linhas repetidas (mesma vela contada até ~6x), o que
 *     invalidou os intervalos de confiança das análises seguintes. Agora cada
 *     arquivo é reescrito como a UNIÃO deduplicada por `from`, ordenada.
 *  2. ORÇAMENTO — o original disparava sequencialmente sem respeitar o limite
 *     global de leitura (60/min, compartilhado por todos os produtos) e o
 *     servidor degradava. Agora tudo passa pelo Scheduler (token bucket,
 *     `retry_after_ms`/`reset_at`, backoff com jitter, circuit breaker).
 *  3. RETOMADA — não havia estado. O original reiniciava do zero a cada
 *     execução. Agora há checkpoint persistente: (produto, asset_id, size)
 *     já concluído é pulado, e o checkpoint sobrevive ao reinício do processo.
 *
 * Dedupe de ATIVOS entre produtos: o mesmo `asset_id` aparece em vários
 * produtos (ex.: UK 100 em binary/turbo/blitz). Coletar o mesmo `asset_id`+size
 * uma vez é suficiente — os candles são do mesmo subjacente.
 *
 * Uso:
 *   IQ_MCP_TOKEN=... IQ_MODE=probe   node diagnostic-results/iq_otc_collect.mjs
 *   IQ_MCP_TOKEN=... IQ_MODE=collect node diagnostic-results/iq_otc_collect.mjs
 *
 * Variáveis: IQ_PRODUCTS (lista), IQ_SIZES (padrão 60,300), IQ_ONLY_REAL (1|0),
 *            IQ_MAX_ASSETS (padrão 0 = todos), IQ_OUT_ROOT, IQ_COUNT (padrão 1000).
 *
 * Limite físico: o MCP devolve no máximo 1000 candles por chamada e não expõe
 * paginação por intervalo de tempo. A profundidade só cresce ACUMULANDO ao
 * longo do tempo — é por isso que o checkpoint e o dedupe são indispensáveis.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Scheduler, dedupeAssets, SERVERS } from "./iq_mcp_scheduler.mjs";

const TOKEN = process.env.IQ_MCP_TOKEN;
if (!TOKEN) { console.error("Defina IQ_MCP_TOKEN"); process.exit(1); }
const MODE = process.env.IQ_MODE ?? "probe"; // probe | collect
const OUT_ROOT = process.env.IQ_OUT_ROOT ?? "diagnostic-results/data/iq-otc";
const COUNT = Number(process.env.IQ_COUNT ?? 1000);
const SIZES = (process.env.IQ_SIZES ?? "60,300").split(",").map((s) => Number(s.trim())).filter(Boolean);
const ONLY_REAL = process.env.IQ_ONLY_REAL === "1";
const MAX_ASSETS = Number(process.env.IQ_MAX_ASSETS ?? 0);
const PRODUCTS = (process.env.IQ_PRODUCTS ?? SERVERS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const HEADER = "from,to,open,high,low,close";

const sched = new Scheduler({ token: TOKEN, perServerBudget: Number(process.env.IQ_BUDGET ?? 500), minGapMs: 2500 });

/** Une o CSV existente com candles novos: dedupe por `from`, ordenado, sem repetir. */
function mergeCandles(file, candles) {
  /** @type {Map<number, string>} */
  const byFrom = new Map();
  if (existsSync(file)) {
    for (const l of readFileSync(file, "utf8").trim().split(/\r?\n/).slice(1)) {
      if (!l) continue;
      const t = new Date(l.split(",")[0]).getTime();
      if (Number.isFinite(t)) byFrom.set(t, l);
    }
  }
  const before = byFrom.size;
  for (const c of candles) byFrom.set(new Date(c.from).getTime(), [c.from, c.to, c.open, c.max, c.min, c.close].join(","));
  const rows = [...byFrom.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, [HEADER, ...rows].join("\n") + "\n");
  return { total: rows.length, added: rows.length - before, duplicatesAvoided: candles.length - (rows.length - before) };
}

const manifest = {
  collectedAtUtc: new Date().toISOString(),
  read_only: true,
  orders_placed: false,
  read_only_tools_only: true,
  rate_limit: "global 60 leituras/min por token (bucket `read`); respeita retry_after_ms e reset_at",
  history_ceiling: `MCP: máx ${COUNT} candles por chamada, sem paginação por intervalo`,
  mode: MODE,
  products: [],
  series: [],
  skipped_done: 0,
};

/** Passo 1: descobrir ativos por produto e deduplicar por asset_id entre produtos. */
const perProduct = {};
if (MODE === "collect" || MODE === "probe") {
  for (const product of PRODUCTS) {
    try {
      const r = await sched.call(product, "list_assets", {});
      perProduct[product] = r.data?.assets ?? [];
      const caps = await sched.call(product, "get_capabilities", {}).then((x) => x.data?.mode ?? "?").catch(() => "?");
      sched.log(`\n=== ${product} | mode=${caps} | ativos=${perProduct[product].length}`);
      manifest.products.push({ product, mode: caps, assets: perProduct[product].length });
    } catch (e) {
      sched.log(`${product}: ERRO ${String(e.message).slice(0, 180)}`);
      manifest.products.push({ product, error: String(e.message).slice(0, 180) });
    }
  }
}

const allAssets = dedupeAssets(perProduct);
const rawTotal = Object.values(perProduct).reduce((a, v) => a + v.length, 0);
sched.log(`\nativos: ${rawTotal} entradas em ${Object.keys(perProduct).length} produto(s) → ${allAssets.length} únicos por asset_id`);

if (MODE === "probe") {
  mkdirSync(OUT_ROOT, { recursive: true });
  writeFileSync(join(OUT_ROOT, "PROBE.json"), JSON.stringify({ ...manifest, uniqueAssets: allAssets.length, rawTotal, assets: allAssets }, null, 2));
  sched.log("\nfim (probe)");
  process.exit(0);
}

/** Passo 2: coletar, com checkpoint por (ativo, size) e dedupe na escrita. */
const targets = (ONLY_REAL ? allAssets.filter((a) => !/OTC/i.test(String(a.name))) : allAssets)
  .filter((a) => a.is_open !== false)
  .slice(0, MAX_ASSETS > 0 ? MAX_ASSETS : undefined);

sched.log(`alvo: ${targets.length} ativos abertos${ONLY_REAL ? " (só mercado real)" : ""}, sizes=${JSON.stringify(SIZES)}`);

for (const a of targets) {
  for (const size of SIZES) {
    const key = `series:${a.asset_id}:${size}`;
    const safe = String(a.name).replace(/[^A-Za-z0-9]/g, "-").replace(/-+/g, "-");
    const dir = join(OUT_ROOT, a.products[0]);
    const file = join(dir, `${safe}_${size}s.csv`);
    if (sched.isDone(key)) { manifest.skipped_done++; continue; }
    try {
      const r = await sched.call(a.products[0], "get_candles", { asset_id: a.asset_id, size, count: COUNT });
      const candles = r.data?.candles ?? [];
      if (!candles.length) { sched.log(`  ${a.name} ${size}s: vazio`); continue; }
      const m = mergeCandles(file, candles);
      const spanH = ((new Date(candles.at(-1).to) - new Date(candles[0].from)) / 3_600_000).toFixed(1);
      sched.log(`  ${a.name} ${size}s: recebidos ${candles.length}, +${m.added} novos (evitadas ${m.duplicatesAvoided} duplicatas) → ${m.total} barras únicas, janela ${spanH}h`);
      manifest.series.push({ asset_id: a.asset_id, name: a.name, product: a.products[0], products_offering: a.products, size, received: candles.length, added: m.added, duplicatesAvoided: m.duplicatesAvoided, totalUnique: m.total, firstFrom: candles[0].from, lastTo: candles.at(-1).to, windowHours: Number(spanH) });
      sched.markDone(key);
      sched.saveCheckpoint();
    } catch (e) {
      sched.log(`  ${a.name} ${size}s: FALHOU ${String(e.message).slice(0, 140)}`);
      manifest.series.push({ asset_id: a.asset_id, name: a.name, size, error: String(e.message).slice(0, 140) });
    }
  }
}

mkdirSync(OUT_ROOT, { recursive: true });
writeFileSync(join(OUT_ROOT, "MANIFEST-COLETA.json"), JSON.stringify({ ...manifest, scheduler: sched.report() }, null, 2));
sched.log(`\nfim · ${JSON.stringify(sched.report())}`);
