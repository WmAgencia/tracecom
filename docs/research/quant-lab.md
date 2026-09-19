# QUANT / RESEARCH PLATFORM (v1)

- **Modo:** RESEARCH_ONLY. Nao decide, nao executa, nao altera G2/V3/V4/Late Window/Quality Gate/JIT/
  Execution Gate/stake/allowlist REAL. Jobs pesados rodam em child process (relay tem prioridade).
- **Codigo:** `relay/research-lab/*` + `relay/research-worker.mjs` + migration `035`.

## Superficies

| Area | Modulo | Nota |
|---|---|---|
| Snapshot meta (asOf/window/N/source/datasetVersion) | `snapshot.mjs` | toda resposta/endpoint carrega |
| Coverage audit | `coverage-audit.mjs` | VALID/DERIVED_VALID/STALE/MISSING/UNAVAILABLE/DEFAULTED/INVALID + NATIVE/DERIVED |
| Factor Lab | `factors/*`, `factor-registry.mjs` | 106 registrados (23 nativos + 83 importados price-only do Vibe e5f7195); catalogo factual de 462 fatores em `docs/research/data/vibe-zoo-catalog.json` |
| Purity anti-lookahead | `purity.mjs` | prefix equality, future perturbation, warmup, padroes proibidos |
| Alpha Bench | `bench.mjs` | cobertura, distribuicao, estabilidade, WR condicional, edge pp, IC/RankIC/ICIR so com alvo continuo |
| Redundancia | `math.mjs::clusterByCorrelation` | pearson/spearman/MI + clusters (0.8) |
| Ablation Lab | `ablation.mjs` | mascara experimental do V4; V4 implantado intocado |
| Backtest Lab | `backtest.mjs` | mecanica binaria (entry/expiry/direction/payout), execution model com cutoff/JIT/Late Window, payout UNKNOWN quando ausente |
| Validacao | `backtest.mjs` | point-in-time, walk-forward, purged k-fold, embargo, CPCV, holdout, bootstrap, Monte Carlo |
| Registries | `registries.mjs` | datasets/experimentos/hipoteses/modelos (Postgres 035 + memoria) |
| Strategy×Regime | `registries.mjs` | N/W/L/D, WR, CI95, expectancy, PnL, DD, streak, evidenceQuality |
| Journal Intelligence | `intelligence.mjs` | padrao → hipotese pre-registrada (nunca regra) |
| Drift | `intelligence.mjs` | feature/prediction/performance/regime: alerta apenas |
| Calibration / ML | `intelligence.mjs` | Brier/reliability/ECE; XGBoost/CatBoost com status AVAILABLE/UNAVAILABLE; logistica L2 propria |
| Research Agents + DAG | `agents.mjs` | 8 papeis; LLM opcional fora do hot path |
| Jobs | `jobs.mjs` + `research-worker.mjs` | concurrency 1, timeout 120s, 60/h, cancelamento, persistencia |
| Checkpoints | `checkpoints.mjs` | 30/60/100/200/500 settlement direcionais; WAIT fora do WR |
| API | `api.mjs` | `/api/iq/research/lab/*` (GET/POST) + proxy Vercel |
| UI | `src/http/public/research/index.html` | OVERVIEW/AGENTS/FACTORS/ALPHAS/BACKTESTS/STRATEGIES/REGIMES/EXPERIMENTS/HYPOTHESES/MODELS/JOURNAL/SHADOW/DATA QUALITY/JOBS |

## Licencas (importados)

- qlib158: microsoft/qlib pin `d5379c52` (Apache-2.0) — adaptado para operadores TS proprios.
- alpha101: Kakushadze (2015) arXiv:1601.00991. gtja191: relatorio GTJA 2014 (formulas factuais).
- Codigo JS escrito do zero sobre `ops.mjs`; nenhum arquivo Python copiado. Catalogo gerado por
  `scripts/vibe-zoo-catalog.mjs` a partir do clone no commit auditado.

## Deploy

`npm run deploy:prod` (scripts/deploy-prod.mjs): preflight → typecheck → testes do lab → build →
`railway up` (servico `tracecom-live-relay`, CLI ja autenticada) → `vercel --prod` → smoke.
Nenhum segredo no script. **Push no GitHub NAO auto-deploya**; este script e o caminho verificado.
