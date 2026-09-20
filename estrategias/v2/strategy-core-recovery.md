# V2 — recuperação e reativação como Strategy Core (rodada v2-live)

## Origem exata (sem reconstrução de memória)
- Core: `relay/rsi-skills-v2.mjs` — **inalterado** (hash congelado em `docs/research/data/rsi-agents-v2-freeze.json`).
- Comparativo original: `relay/rsi-agents-v2.mjs` — split 50/50 STRICT/PULLBACK via `computeFiftyFiftySplit` (reutilizado, não reescrito).
- Freeze: `docs/research/data/rsi-agents-v2-freeze.json` (inclui runtime + `relay/rsi-agents-v2-live.mjs`).
- Testes históricos: `tests/research/rsi-agents-v2-freeze.test.ts`, `tests/research/execution-routing.test.ts`.

## Definição exata recuperada (resumo fiel ao código)
- Detector RSI Wilder 14: BUY candidate em extremo inferior, SELL em extremo superior (limiares em `RSI_SKILLS_V2_POLICY`).
- Episódio V2 (`createEpisodeV2`/`updateEpisodeV2`): touched/outside/reentered por banda, min/max RSI, max/min de +DI/-DI e spread, streaks de reação oposta, expiração por idade e por neutralização.
- STRICT V2 (`strictEvaluate`): confirmação de reversão com DI/ADX coerentes e bloqueio de tendência estrutural contrária forte.
- PULLBACK V2 (`pullbackEvaluate`): continuação após o extremo com rejeição de banda e reação do DI novo.
- `status`/`reason` originais preservados (ex.: `STRICT_WAITING_CONFIRMATION`).

## Infraestrutura moderna (NÃO faz parte do core V2)
- ACTIVE_CANDIDATE + PRIORITY_FINAL_WATCH (1 avaliação por candle, dedupe por bucketEnd).
- Última avaliação causal antes do safe cutoff; MISSED fail-closed; sem anticipação/dado futuro.
- Revalidação pré-submit: **a própria V2 precisa continuar aprovando** o snapshot causal mais recente.
- `entrySnapshot` imutável, MESAS/registry, telemetria e audit trail atuais.
- Routing `RSI_V2_ONLY`; V4 permanece calculável em shadow (`controlsExecution=false`).

## Amostra nova
`estrategias/v2/runs/<run-id>/first-10-trades/` (gerada por `scripts/rsi-v4-export-first10.mjs --strategy=v2-live`).
Não misturar com trades históricos da V2.
