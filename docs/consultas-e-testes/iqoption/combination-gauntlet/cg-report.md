# CROSS-FAMILY COMBINATION GAUNTLET — RELATÓRIO FINAL

> **FINAL STATUS: NO_PROSPECTIVE_70_PERCENT_EDGE** (tranche prospectiva P1 = 0,90h por instrumento; nenhum ≥70%; nenhum candidato 60–70% sustentável — o melhor com n relevante é ~53% T+300).

## PROTOCOLO
- **Dados**: MESMOS 167,18h oficiais por instrumento (`*_7D`, BINARY e OTC separados). Todo o período = **COMBINATION DISCOVERY LAB** (conhecido). Reorganizado em TRAIN 0–60% · VAL 60–80% · HOLD 80–100% (embargo 24 candles). Nada foi refetchado para descoberta.
- **Componentes (G0, implementações REAIS dos gauntlets anteriores)**: 16 — `tlbrk70`, `tlbrk50`, `fb25` (Breakout Gauntlet; trendline/false-break recomputados causalmente no motor kh, janelas ≤24), `v7relaxed/v7and/v1/v3/v6` (Fib congeladas, via compilador congelado), `z240` (F01), `exrsi` (F02), `cp` (F03), `acfade` (F04), `mk3` (F05, tabela treinada SÓ no TRAIN e congelada), `miimb` (F06), `enperm` (F07), `humr` (F08). + 6 MÁSCARAS (enlow, hurstMR, cpActive, burst, h11_18, lowvol).
- **Gerações congeladas ANTES de avaliar (hashes)**: G1 = 456 pares/gates (×2 mercados) · G2 = 142/139 (AND3 entre top componentes + gates extras sobre sobreviventes) · G3 = 30/30 (gate extra sobre top G2) · G4 = meta-labeling (logistic sobre sinais da base, treino só no TRAIN) + regime switching (hurst/entropy). BH-FDR por geração.
- **Horizontes**: T+60s (1min, primário) e **T+300s (5min)**.
- **Prospective P1**: coletado APÓS o freeze (freezes 00:35:55–59Z < primeiro fetch 00:36:34Z), janela 23:07:25Z→00:01:33Z (0,90h), persistido no Supabase (`*_P1`), raw em disco.

## RESULTADO — DESCOBERTA (TRAIN → VAL)
| Mercado | Melhor G1/G2/G3 | TRAIN | VAL | Nota |
|---|---|---|---|---|
| BINARY | AND(z240,enperm) [=CONFIRM] | 55,72% (n=2.073, indep 119/58,0) | **47,56%** | colapso clássico de seleção |
| BINARY | OR(z240,mk3) / GATE(z240,enlow/lowvol) | 54,80% (n=2.529) | 47,49% | máscaras `enlow/lowvol` = **NO-OP decorativo** (ablation: 0/2188 sinais bloqueados) |
| BINARY | G4 meta sobre G3 | **65,20%** (n=296) | **44,10%** (n=195) | meta-labeling super-aqueceu no TRAIN |
| OTC | GATE(exrsi,h11_18) | 52,48% (n=8.024, indep 452) | 51,77% (n=3.744) | melhor frequência×WR da descoberta (~80/h) |
| OTC | GATE(humr,h11_18) | 53,30% (n=2.139) | 50,94% | — |
| OTC | G2: exrsi+h11_18+hurstMR | 55,03% (n=1.728) | 49,79% | — |
| OTC | G4 meta sobre G3 | **64,22%** (n=341) | 52,60% (n=154) | melhor meta do experimento |
| Ambos | G4 regime-switch | 49,3–50,4% | 49,0–50,0% | estável e mediano |
| **Nenhum ≥70% em TRAIN/VAL/HOLD/qualquer geração.** |

## PROSPECTIVE P1 (dados NOVOS, 0,90h por instrumento)
| Finalista | MKT | T+60 sig/WR | T+300 sig/WR | indep (T300) | Edge T60 |
|---|---|---|---|---|---|
| G1–G3 z240+enperm (+enlow/lowvol) | BIN | 29 / **37,93%** | 31 / 64,52% ⚠n=31 | 0 | −15,8pp |
| G4 meta (derivado) | BIN | 1 / 100% ⚠n=1 | 1 / 100% ⚠n=1 | 0 | — |
| G4 regime-switch | BIN | 182 / 48,35% | **180 / 61,11%** (indep 6; recálculo conservador do crítico: 32/48,3%) | 6 | −2,1pp |
| G0 v7relaxed | BIN | 29 / 20,69% | 32 / 34,38% | 2 | −29,4pp |
| G1/G2/G3 exrsi/humr gates (11-18h) | OTC | **0 sinais** — janela P1 fora de 11-18h | — | — | — |
| G4 regime-switch | OTC | 284 / 50,00% | 263 / 53,23% (15/66,7% shipped; 32/48,3% no recálculo conservador) | 15–32 | −0,2pp |
| G0 v7relaxed | OTC | 16 / 43,75% | 16 / 56,25% | 0 | −5,0pp |

**Baselines P1**: BIN buy 53,75%/sell 46,25% (T60) · OTC buy 46,70%/sell 53,30% (T60).

## CRÍTICO INDEPENDENTE (8 papéis) — pontos principais
- Integridade de componentes/rebuild: **PASS** (0 mismatches; rebuildVec == AND real no P1).
- Causalidade (truncamento/perturbação em features+meta+RS): **PASS 30/30 bit-identical**.
- Prospectivo recomputado do raw: **PASS** (métricas do crítico batem os claims shipped; ints exatos).
- Hash: **FAIL parcial corrigido** — META/RS tinham hash calculado antes de anexar pesos/spec completo; **corrigido para cobrir o spec congelado inteiro** (estratégias inalteradas; artefato re-escrito com nota). Agora 16/16.
- Data snooping/multiple testing: freezes antes da avaliação confirmados; top-gate OTC q=0,0008 reproduzido; porém vencedores de TRAIN não sobrevivem ao VAL (viés de seleção demonstrado em 3 níveis).
- Ablation: máscaras enlow/lowvol = decorativas (no-op) → removidas do finalista na prática (mantidas no arquivo por transparência).
- Independência: **lattice artifact** — recálculo conservador do crítico reduz indepN (ver tabela); nenhum claim relevante depende de n>30.
- 70% audit: **0 ocorrências ≥70% com n≥50** em qualquer split/horizonte.

## RESPOSTAS OBRIGATÓRIAS
A. **Combinações realmente testadas: 1.289** (G0 32 · G1 912 · G2 281 · G3 60 · G4 4) + seleções internas; tudo registrado com hash em `cg/*-freeze-*.json`.
B. Maior WR discovery: **N≥100**: 64,22% (meta OTC, n=341, TRAIN) · **N≥500**: 55,72% (BIN, n=2.073) · **N≥1000**: 55,72% · **N≥2500**: 54,80% (n=2.529).
C. Maior WR com ≥10 sinais/h: **55,72%** (BIN z240+enperm, ~21/h, TRAIN; VAL 47,6%) — OTC gate 51,8% @80/h no VAL.
D. ≥20/h: idem C (55,7% TRAIN / 47,6% VAL).
E. ≥50/h: **51,77%** (OTC GATE exrsi h11-18, 80/h, VAL) · RS ~50% @215–335/h.
F. Famílias que mais se complementaram: **MR extremo (z240) + entropia de permutação baixa (enperm)** no BINARY (apenas TRAIN); **RSI extremo + regime Hurst-MR + entropia baixa + horário 11-18h** no OTC (VAL ~50-52%); correlação de erro menor entre `enperm` e `exrsi` que entre os demais pares.
G. Melhor BUY model: RS-BIN BUY 50% (P1) / histórico tlbrk BUY 62,4% (2016 amostras dez) — nada consistente.
H. Melhor SELL model: RS-OTC SELL 54% e tlbrk_0.7 SELL 66,5% (histórico do Breakout Gauntlet); P1: OTC v7relaxed SELL 20-60% instável.
I. **Meta-labeling ajudou?** No TRAIN sim (64–65%), **OOS NÃO** (VAL 44,1–52,6%; P1 ≈0–1 sinais) → **não confirmado**.
J. **Regime switching ajudou?** Ficou no meio (49–53%), sem colapso mas sem edge; T+300 do RS-BIN 61% é amostra-nanica (indep 6) → **não confirmado**.
K. **Finalistas congelados: 16** (8 por mercado; ~4 vetores distintos por mercado após dedupe; hashes 16/16 corrigidos).
L. **Horas novas prospectivas: 0,90h por instrumento (1,80h totais)** — tranche P1.
M. **Melhor WR prospectivo**: 61,11% (BIN RS, T+300, n=180 — mas indep 6; recálculo conservador 48,3%) · com n≥250: **53,23%** (OTC RS T+300).
N. **Frequência prospectiva**: 34–335 sinais/h (RS = 215–335/h; gates horários = 0/h fora do horário).
O. **Independent N prospectivo**: máx. 17 (OTC RS) / 6–15 no recálculo conservador — **insuficiente**.
P. **Alguma ≥70% prospectivamente? NÃO.**

## LIMITAÇÕES
Tranche P1 curta (0,9h) → poder estatístico baixo; gates horários estruturais (0 sinais fora da janela 11-18h) expõem fragilidade de seleção por sessão; meta-models super-aqueceram no TRAIN; independência sofre de sobreposição (recalculada de forma conservadora pelo crítico).

## ARTEFATOS E PERSISTÊNCIA
GitHub `docs/consultas-e-testes/iqoption/combination-gauntlet/`: component-registry (em cg-discovery), generation freezes (g1/g2/g3/mk3), finalists-freeze (hashes corrigidos), all-discovery-results, prospective-results P1, ablation, scripts (cg-run/cg-prosp/cg-comps), critic-cg-report, este relatório. Supabase: datasets `*_P1` READY + meta `cg-combination-2026-09-16`. Raw P1 em disco (sha por página via cópia raw). **Nada foi alterado em produção; nenhuma ordem; nenhum clique.**
