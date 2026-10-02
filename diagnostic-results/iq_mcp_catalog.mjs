/**
 * CATÁLOGO MCP — ativos REAIS por produto, deduplicados por asset_id (somente leitura).
 *
 * Resolve três lacunas do coletor original:
 *  1. o coletor gravou apenas o NOME sanitizado, nunca o `asset_id`;
 *  2. os totais por produto não são ativos únicos — o mesmo subjacente se repete;
 *  3. faltava registrar payout e EXPIRAÇÕES realmente oferecidas pelo broker,
 *     que é o que determina se o horizonte de 300s do Binary V3 é executável.
 *
 * Robustez: cada produto é gravado em SEU PRÓPRIO arquivo em
 *   diagnostic-results/data/iq-catalog/<produto>.json
 * e o agregado `iq-catalog.json` é reconstruído a partir do que existe em disco.
 * Assim uma execução interrompida nunca destrói o que já foi coletado.
 *
 * Uso:
 *   IQ_MCP_TOKEN=... node diagnostic-results/iq_mcp_catalog.mjs                       # todos os produtos
 *   IQ_MCP_TOKEN=... IQ_PRODUCTS=binary-options node diagnostic-results/iq_mcp_catalog.mjs
 *   IQ_MCP_TOKEN=x   IQ_PERSIST_ONLY=1        node diagnostic-results/iq_mcp_catalog.mjs  # sem rede
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Scheduler, dedupeAssets } from "./iq_mcp_scheduler.mjs";

const DATA_DIR = process.env.IQ_CATALOG_DIR ?? "diagnostic-results/data/iq-catalog";
const AGG = process.env.IQ_CATALOG_OUT ?? "diagnostic-results/data/iq-catalog.json";
const ALL_PRODUCTS = ["binary-options", "turbo-options", "blitz-options", "digital-options"];
const PRODUCTS = (process.env.IQ_PRODUCTS ?? ALL_PRODUCTS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const TARGETS = ["UK 100", "US 2000", "US 500", "S&P500/Gold", "SP 500 ETF", "S&P 500 ETF"];

mkdirSync(DATA_DIR, { recursive: true });

function loadPerProduct() {
  /** @type {Record<string, any[]>} */
  const out = {};
  for (const f of readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"))) {
    try {
      const j = JSON.parse(readFileSync(join(DATA_DIR, f), "utf8"));
      if (Array.isArray(j.assets) && j.assets.length) out[j.product ?? f.replace(/\.json$/, "")] = j.assets;
    } catch { /* arquivo corrompido é ignorado, não apagado */ }
  }
  return out;
}

function writeAggregate() {
  const perProductRaw = loadPerProduct();
  const dd = dedupeAssets(perProductRaw);
  const rawCounts = Object.fromEntries(Object.entries(perProductRaw).map(([k, v]) => [k, v.length]));
  const agg = {
    generatedAtUtc: new Date().toISOString(),
    read_only: true,
    orders_placed: false,
    note: "Os totais por produto NÃO são ativos únicos. `unique_assets` deduplica por asset_id. Payout e expirações são POR PRODUTO em `byProduct`.",
    products_collected: Object.keys(perProductRaw).sort(),
    raw_counts_per_product: rawCounts,
    raw_sum_products: Object.values(rawCounts).reduce((a, b) => a + b, 0),
    unique_assets: dd.length,
    multiplicities: dd.reduce((a, x) => { a[x.n_products] = (a[x.n_products] ?? 0) + 1; return a; }, {}),
    targets: dd.filter((x) => TARGETS.some((t) => String(x.name).toLowerCase().includes(t.toLowerCase()))),
    assets: dd,
    perProductRaw,
  };
  writeFileSync(AGG, JSON.stringify(agg, null, 2));
  return agg;
}

const sched = new Scheduler({ token: process.env.IQ_MCP_TOKEN, perServerBudget: 40, minGapMs: 2500 });

if (process.env.IQ_PERSIST_ONLY !== "1") {
  for (const product of PRODUCTS) {
    const file = join(DATA_DIR, `${product}.json`);
    if (sched.isDone(`catalog:${product}`) && existsSync(file)) { sched.log(`[skip] ${product} já no checkpoint`); continue; }
    try {
      const assets = await sched.call(product, "list_assets", {});
      const arr = assets.data?.assets ?? assets.data ?? [];
      if (!arr.length) { sched.log(`${product}: list_assets vazio; nada gravado`); continue; }
      sched.log(`\n=== ${product} | list_assets: ${arr.length} ativos`);
      sched.log(`  amostra: ${JSON.stringify(arr[0]).slice(0, 300)}`);
      // Orçamento do gateway é o gargalo: `list_assets` é o único indispensável.
      const skipOptional = process.env.IQ_SKIP_CAPS === "1";
      const caps = skipOptional ? { skipped: true } : await sched.call(product, "get_capabilities", {}).then((r) => r.data).catch((e) => ({ error: String(e.message).slice(0, 160) }));
      const limits = skipOptional ? { skipped: true } : await sched.call(product, "get_limits", {}).then((r) => r.data).catch((e) => ({ error: String(e.message).slice(0, 160) }));
      // grava SÓ depois de ter os dados; um arquivo de produto existente permanece intacto em caso de falha
      writeFileSync(file, JSON.stringify({ product, fetchedAtUtc: new Date().toISOString(), count: arr.length, capabilities: caps, limits, assets: arr }, null, 2));
      sched.markDone(`catalog:${product}`);
      sched.saveCheckpoint();
      sched.log(`  ✓ ${file}`);
    } catch (e) {
      sched.log(`${product}: ERRO ${String(e.message).slice(0, 200)} (nada sobrescrito)`);
    }
  }
}

const agg = writeAggregate();
const dd = agg.assets;

console.log("\n── resumo ──");
console.log("por produto:", agg.raw_counts_per_product, "soma:", agg.raw_sum_products);
console.log("únicos (dedupe asset_id):", agg.unique_assets, "multiplicidade:", agg.multiplicities);
console.log("\n── mapa de expirações por produto (determina a compatibilidade com 300s) ──");
for (const [p, rows] of Object.entries(agg.perProductRaw)) {
  const sizes = new Set(), steps = new Set(), payouts = [];
  for (const a of rows) {
    for (const s of a.expiration_sizes_seconds ?? []) sizes.add(s);
    const ex = a.expirations ?? [];
    for (let i = 1; i < ex.length; i++) steps.add(ex[i] - ex[i - 1]);
    if (typeof a.profit_percent === "number") payouts.push(a.profit_percent);
  }
  payouts.sort((x, y) => x - y);
  console.log(`${p}:`, `n=${rows.length}`, "| expiration_sizes_s=", JSON.stringify([...sizes].sort((a, b) => a - b)), "| passos de expiração=", JSON.stringify([...steps].sort((a, b) => a - b)) + "s", "| payout min/med/max=", `${payouts[0]}/${payouts[Math.floor(payouts.length / 2)]}/${payouts.at(-1)}`);
}
console.log("\n── ativos alvo das hipóteses ──");
for (const t of agg.targets) {
  console.log(`  #${t.asset_id} ${t.name} | aberto=${t.is_open} | produtos=${t.products.join(",")}`);
  for (const p of t.products) {
    const b = t.byProduct[p];
    console.log(`      ${p}: payout=${b.payout}% | sizes=${JSON.stringify(b.expiration_sizes_s)}s | passos=${JSON.stringify(b.expiration_steps_s)}s | 300s=${b.supports_300s}`);
  }
}
console.log(`\ncheckpoint: ${JSON.stringify(sched.report())}`);
sched.saveCheckpoint();
