import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require2 = createRequire("D:/tracecom/repo/relay/package.json");
const pg = require2("pg");
const pool = new pg.Pool({ connectionString: "postgresql://postgres.cladmauwmuoeqongxzwb:Eqvpanp.050323@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=no-verify", ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 30000 });
const q = async (sql) => { try { return (await pool.query(sql)).rows; } catch (e) { return [{ erro: e.message.slice(0, 160) }]; } };

const ROOT = "D:/tracecom/repo";
const sha256 = (rel) => crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex");
const now = new Date().toISOString();

const stats = await q("SELECT count(*) FILTER (WHERE result IN ('WIN','LOSS')) AS settled, count(*) FILTER (WHERE result='WIN') AS wins, count(*) FILTER (WHERE result='LOSS') AS losses, count(*) FILTER (WHERE result='DRAW') AS draws, count(*) FILTER (WHERE result IS NULL) AS open, min(created_at) AS first_at, max(created_at) AS last_at FROM iq_shadow_trades WHERE variant='PULLBACK_4060_300'");
const byRun = await q("SELECT run_id, count(*) FILTER (WHERE result IN ('WIN','LOSS')) AS settled, count(*) FILTER (WHERE result='WIN') AS wins, count(*) FILTER (WHERE result='LOSS') AS losses FROM iq_shadow_trades WHERE variant='PULLBACK_4060_300' GROUP BY 1");
const s = stats[0] ?? {};
const settled = Number(s.settled ?? 0); const wins = Number(s.wins ?? 0); const losses = Number(s.losses ?? 0);
const wr = settled ? Number((100 * wins / settled).toFixed(1)) : null;

const dir = path.join(ROOT, "archive/baseline/PULLBACK_4060_300_BASELINE");
fs.mkdirSync(dir, { recursive: true });
const spec = {
  strategyId: "PULLBACK_4060_300",
  label: "Pullback 300s (RSI 40/60)",
  profileId: "agentic-custom:PULLBACK_4060_300",
  strategyHash: "sha256:" + sha256("relay/agents/custom-strategies.mjs"),
  sourceCommit: "489e7d01413b3bcde8d88323f2478503146ed02f",
  sourceFiles: {
    "relay/agents/custom-strategies.mjs": "sha256:" + sha256("relay/agents/custom-strategies.mjs"),
    "relay/consensus/snapshot.mjs": "sha256:" + sha256("relay/consensus/snapshot.mjs"),
    "relay/agents/candle.agent.mjs": "sha256:" + sha256("relay/agents/candle.agent.mjs"),
    "relay/agents/rsi.agent.mjs": "sha256:" + sha256("relay/agents/rsi.agent.mjs"),
    "relay/agents/adx.agent.mjs": "sha256:" + sha256("relay/agents/adx.agent.mjs"),
    "relay/agents/atr.agent.mjs": "sha256:" + sha256("relay/agents/atr.agent.mjs"),
    "relay/agents/bollinger.agent.mjs": "sha256:" + sha256("relay/agents/bollinger.agent.mjs"),
  },
  params: {
    expirySeconds: 300,
    direction: "estrutura UP => BUY; estrutura DOWN => SELL (swingStructure HH/HL vs LH/LL, fallback candle.trend + dominancia)",
    rsi: { buyMax: 40, sellMin: 60 },
    gate: { atr: "state != DEAD e !climactic", adx: "regime != RANGE", slope: "bollinger.middleSlope alinhado a direcao", choch: "veta se CHoCH contra a estrutura" },
    cooldownSecondsPerAsset: 60,
  },
  timing: { entry: "custom strategies avaliam a qualquer momento (cooldown 60s por ativo/estrategia)", expiry: "at + 300s", settlement: "candle do feed que cobre o vencimento (+-12s)" },
  measurement: { source: "iq_shadow_trades", level: 0, variant: "PULLBACK_4060_300", runs: byRun },
  frozenAt: now,
  note: "Baseline definida por spec/hash/codigo. Os numeros observados sao estatisticas DESTA MESMA spec e continuam crescendo com novas observacoes (nao criam nova versao).",
};
fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify(spec, null, 2));
fs.writeFileSync(path.join(dir, "stats-snapshot.json"), JSON.stringify({ capturedAt: now, settled, wins, losses, draws: Number(s.draws ?? 0), open: Number(s.open ?? 0), winRate: wr, firstAt: s.first_at, lastAt: s.last_at, byRun }, null, 2));
fs.copyFileSync(path.join(ROOT, "relay/agents/custom-strategies.mjs"), path.join(dir, "custom-strategies.mjs"));
fs.writeFileSync(path.join(dir, "README.md"), "# PULLBACK_4060_300_BASELINE\n\nSpec congelada da unica familia sobrevivente (Etapa 1 da reconstrucao controlada).\n\n- Identidade definida por **spec/hash/codigo** (commit 489e7d0), nao pelos numeros observados.\n- Numeros sao desta MESMA spec e continuam crescendo (mais observacoes != nova versao).\n- Filha: `PULLBACK_4060_300_AGENTIC_V2` (estrategias/strategy-versions/).\n");

const vdir = path.join(ROOT, "estrategias/strategy-versions");
fs.mkdirSync(vdir, { recursive: true });
const v2 = {
  strategyVersion: "PULLBACK_4060_300_AGENTIC_V2",
  parent: "PULLBACK_4060_300_BASELINE",
  parentStrategyHash: spec.strategyHash,
  newStrategyHash: null,
  newStrategyHashNote: "definido quando a implementacao V2 (Etapas 2-3) existir; so entao a V2 pode operar",
  createdAt: now,
  changeDescription: "Nova arquitetura: Asset Agent por ativo (contexto 3h / 2160 candles, ring buffer + hidratacao), especialistas (RSI, DMI/ADX, Bollinger, ATR, PriceAction) recebendo AssetContext primeiro, Consensus sem confidence (BUY/SELL/WAIT + thesis/blockers/invalidations), 300s unico, BINARY OTC only, sem Blitz, um unico caminho de execucao com Account Router (PRACTICE/REAL mesma inteligencia).",
  statsEpoch: now,
  stats: { operations: 0, wins: 0, losses: 0, draws: 0, winRate: null },
  runId: "pullback-4060-300-agentic-v2",
  status: "PENDING_IMPLEMENTATION — NAO OPERA (Etapas 2-3 antes de qualquer deploy/execucao)",
};
fs.writeFileSync(path.join(vdir, "PULLBACK_4060_300_AGENTIC_V2.json"), JSON.stringify(v2, null, 2));

const wf = `name: snapshot

# Snapshots grandes (zip/manifest) NAO entram no historico do git.
# Git = historico do codigo. Snapshot = artifact de workflow (retencao GitHub).

on:
  workflow_dispatch: {}
  schedule:
    - cron: "0 6 * * 1"

permissions:
  contents: read

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - name: Gerar manifesto + zip do codigo operacional
        run: node scripts/backup-manifest.mjs
      - name: Publicar snapshot como artifact
        uses: actions/upload-artifact@v4
        with:
          name: tracecom-snapshot-\${{ github.run_number }}
          path: |
            backups/manifest-*.txt
            backups/tracecom-*.zip
          retention-days: 90
`;
fs.mkdirSync(path.join(ROOT, ".github/workflows"), { recursive: true });
fs.writeFileSync(path.join(ROOT, ".github/workflows/snapshot.yml"), wf);

console.log("BASELINE", JSON.stringify({ strategyHash: spec.strategyHash, settled, wins, losses, draws: s.draws, open: s.open, wr }));
console.log("V2", JSON.stringify({ statsEpoch: v2.statsEpoch, runId: v2.runId, status: v2.status }));
console.log("FILES", JSON.stringify(fs.readdirSync(dir)));
await pool.end().catch(() => undefined);
