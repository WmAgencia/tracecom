# TraceCom — Estratégia ativa e configuração (checkpoint vivo)

> **Este documento é o "cofre" da configuração que está funcionando.** Sempre que algo for
> alterado no sistema, atualizar aqui primeiro e gerar um novo backup (`scripts/backup-config.mjs`).
> Última atualização: **2026-09-21 22:05 UTC** · commit `13f803d` · tag `checkpoint-2026-09-21-agentic-safety`.

## 1. Estratégia ativa — AGENTIC RSI + FIBONACCI (Binário OTC)

**Arquitetura:** 5 agentes especialistas + 1 consenso senior, todos sobre o MESMO snapshot imutável:

| Camada | Arquivo | Papel |
|---|---|---|
| Agentes | `relay/agents/rsi.agent.mjs`, `bollinger.agent.mjs`, `adx.agent.mjs`, `atr.agent.mjs`, `fib.agent.mjs` | opiniões estruturadas (sem LLM no hot path) |
| Consenso | `relay/agents/consensus.agent.mjs` | síntese semântica (nunca votação) → BUY/SELL/WAIT |
| Grafo | `relay/agents/graph.mjs` | orquestra os 5 agentes + consenso (1 snapshot → 1 decisão) |
| Medidor A/B | `relay/agents/safety-shadow.mjs` | trades de papel liquidados pelo feed, por nível/variante |

**Regras de entrada (o que está valendo):**
1. Gatilho: RSI(14) em 5s toca **≥70 (SELL) / ≤30 (BUY)**.
2. Confluência obrigatória: qualidade do RSI (divergência / failure swing / crossback) **+** ADX a favor **+** ATR vivo **+** localização (Bollinger com rejeição/range **ou** Fibonacci com reação na zona).
3. **Vetos sempre ativos:** `MOVIMENTO_CONSTANTE_CONTRA` (movimento contínuo contra a tese: ≥72% dos candles, pullback ≤0,6×ATR, ≥1,2×ATR, ADX ≥30 subindo), `SEM_CONFIRMACAO_REVERSAO`*, `STOCH_SEM_EXTREMO`*, `SQUEEZE_SEM_REVERSAO`* (*ativos quando ligados no nível/variante), `FIB_LEG_INCOMPATIVEL`, `ATR_MERCADO_MORTO/CLIMATICO`, `BOLLINGER_WALK_CONTRA`, `ADX_TENDENCIA_ANTIGA_FORTALECENDO`, `RSI_EXTREMO_ACELERANDO`, `FIB_ZONE_BROKEN`.
4. **Segurança (0–100%)**: 100% = todos os vetos valem (rígido). Abaixo disso o consenso passa a tolerar vetos fracos na ordem: Fib leg → Fib zona → ATR climático → ADX antigo → RSI acelerando → ATR morto → Bollinger walk.
   - **Valor em produção: 50%** (destrava o "Bollinger walk", mantendo o resto).
5. **Janela de entrada: T-34s .. T-31,5s** antes do vencimento (3–4s antes do corte do broker em T-30) — a análise roda em tempo real desde o gatilho; a ordem sai o mais tarde possível.
6. Execução: 1 ordem por vez, stake do painel, **PRACTICE** (real só com arm explícito do operador).

**Níveis do medidor A/B (mesma entrada, lado a lado):** `50` (base) · `50F` (+confirmação de candle) · `50T` (+Stochastic 14,3,3 no extremo) · `50FT` · `50S` (+sem squeeze) · `50FTS` · e os níveis 100/90/80/70 para referência.

## 2. Configuração em produção (snapshot)

- **Modo:** PRACTICE · auto_execute: true · stake default: 1 · arm: ARM_PRACTICE (R$ 2)
- **Segurança dos agentes:** **50%** · níveis A/B: `100,90,80,70,50,50F,50FT,50FTS,50S,50T`
- **Run agentic:** `agentic-rsi-fib-20260921` (cap 50) · 30 OTC habilitados (Binary OTC only)
- **Contadores zerados desde:** 2026-09-21T16:53:38Z (`iq_perf_epoch`)
- **MCP oficial:** configurado (turbo; token fora do backup) · endpoint `turbo-options.mcp.iqoption.com`
- **Desempenho desde o deploy 21:33Z (stake 1):** 10 ops · 9 WIN · 1 DRAW · 0 LOSS · **+7,38** (WR 100% dos decididos)

## 3. Infra

- Relay: `https://tracecom-live-relay-production-4e43.up.railway.app` (Railway, service `tracecom-live-relay`)
- Front: `https://tracecom.consecom.com.br` (Vercel, projeto `tracecom`)
- DB: Supabase (free) — **manter < 475 MB**; retenção automática de 24h em `iq_lab_decisions` + `VACUUM FULL` quando > 300 MB (`runDbMaintenance`).
- Backups: `scripts/backup-config.mjs` (gera zip sem segredos) · `scripts/restore-config.mjs` (dry-run/aplica).

## 4. O que NÃO pode regredir

1. Janela de entrada T-34..T-31,5s (entrada tardia).
2. Segurança 50% e os vetos duros (constância, walk, fib, ATR).
3. Execução só em PRACTICE até decisão explícita de real.
4. Retenção/limpeza do banco (nunca deixar passar de ~475 MB).
5. Este documento + backup atualizado a cada mudança.
