# QUANT LAB — GAUNTLET (criticas e pendencias)

## FRESH QUANT CRITIC
- 462 fatores do Vibe classificados por leitura real do codigo (`__alpha_meta__`), nao por relatorio.
- 223 marcados UNAVAILABLE_FOR_OTC (volume/fundamental/sector); 17 exigem adaptacao cross-sectional;
  222 price-only. Apenas 83 foram portados (subconjunto deliberado, licencas registradas).
- Registry sem promocao automatica; transicoes manuais auditadas (testado).

## STATISTICAL CRITIC
- Bench usa WR condicional/CI95; IC so com alvo continuo (nao forcado em WIN/LOSS).
- Checkpoints excluem WAIT do denominador; coverage separado; aviso de N pequeno em toda metrica.
- Backtest nao soma PROSPECTIVE/BACKTEST/PRACTICE; payout UNKNOWN quando ausente (hipotetico exige flag).

## LEAKAGE CRITIC
- Purity suite: prefix equality + future perturbation + warmup + padroes proibidos; testada em 40 fatores.
- Factors importados usam apenas candles ate t; T0 readers point-in-time.

## LICENSING CRITIC
- Vibe MIT (commit `e5f7195`), qlib158 Apache-2.0 com NOTICE, formulas academicas citadas.
- Nenhum codigo Fincept/AGPL copiado; arquitetura clean-room (documentada em `vibe-fincept-audit.md`).

## PERFORMANCE CRITIC
- Jobs em child process com concurrency 1/timeout/rate limit; relay nunca bloqueia (teste de rate limit).
- Endpoints do lab sao leitura + bench limitado (default 40 fatores, 500 linhas).

## Pendências honestas
1. UI criada mas ainda nao validada em producao nesta rodada (deploy pendente de execucao).
2. `deploy:prod` existe e documentado; CI/CD externo continua manual (github push nao auto-deploya).
3. Coverage/bench com T0 historico pequeno; resultados sao exploratorios ate N crescer.
4. ML Lab: XGBoost/CatBoost tipicamente UNAVAILABLE no ambiente atual; logistica L2 propria disponivel.
5. Jobs persistem payload/result resumido; artefatos completos ficam no child (expansao futura).
