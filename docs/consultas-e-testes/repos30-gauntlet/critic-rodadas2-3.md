# Crítico independente — rodadas 2 e 3 (adapters po1/po2)

## Rodada 2 (v2.1.0) — VEREDITO: FAIL
- po1 tolerance adapter 0.0002*close vs fonte `max(0.0005*price, 0.0003)` (new_signal.py:450-455) → DEVIATION material.
- po1 warm-up: fonte exige ≥60 candles 1m antes de qualquer sinal (new_signal.py:626-631); adapter disparava a partir do 4º minuto.
- po1 pivôs: candidato na borda esquerda da janela de 60 fora da semântica do slice `[-60:]`.
- po2: cross ≠ estado (fonte usa `ema_diff>0 & rsi>=52`, strategy.py:124-130), estrito `>52/<48` vs `>=52/<=48`, e faltavam filtros chop (0.05%/20), momentum, banda neutra ±1.5, streak≥2 e voto ponderado; seed RSI deve ser SMA das primeiras 14 diferenças.

## Correções aplicadas (v2.2.0)
- po1: `tol = max(0.0005*C, 0.0003)`; gate i≥719 (=60 candles 1m fechados); pivôs t=m-58..m-1 com vizinhos dentro da janela; RSI Cutler e lógica de combinação inalteradas.
- po2: port integral de `strategy.py` (janela 300 closes 1m; clamps dinâmicos; EMA seed SMA; RSI seed SMA+Wilder; chop; streak; primários com momentum; banda neutra; voto fallback). Label de TF corrigido para o caminho pocket (timeframe_sec=60).

## Rodada 3 (v2.2.0) — VEREDITO: PASS WITH RESERVATIONS
- `po1_levels_min`: PASS — tolerância/janela/gate linha-exatos (S1:450-455/507-517/626-631).
- `po1_priceaction_min`: PASS — pinbar/engulfing exatos (S1:520-549) + gate aplicado.
- `po1_multifactor_min`: PASS — Cutler + combinação um-lado/MIN_FACTORS=1 exatos nos defaults.
- `po2_ema_rsi_min`: PASS — strategy.py:82-151 portado linha-a-linha; clamps só inalcançáveis no warm-up do replay.
- Aritmética dos agregados v3 conferida (qu1_revert3 BINARY, po2 BINARY, po1 OTC).
- Ressalvas (não-desvios de lógica): guarda `MIN_SIGNAL_INTERVAL_SEC` po1 não modelada (≈no-op a 1 sinal/min); camada de execução po2 (poll 2s, confirm-polls, gates de risco) excluída; janela <300 no warm-up; contagens v3 não recomputadas por re-execução (explicadas por tolerância/gate).
