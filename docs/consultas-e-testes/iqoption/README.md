# IQ OPTION â€” VALIDAÃ‡ÃƒO EXTERNA (10h, dados pÃºblicos oficiais)

> **Escopo**: pesquisa shadow/offline. Sem extensÃ£o, sem sessÃ£o autenticada, sem bypass. Nenhuma estratÃ©gia de produÃ§Ã£o foi alterada.

## Fonte (provenance A â€” IQ_OPTION_OFFICIAL)
- Endpoint pÃºblico: `GET https://api.iqoption.com/v3/quotes?active_id&from&to&only_round=false`
- Descoberto no bundle JS pÃºblico da prÃ³pria pÃ¡gina `iqoption.com/quotes` (gateway_api do `/api/configuration` oficial); a chamada da pÃ¡gina usa `credentials:"omit"` (sem cookie/sessÃ£o). Feed tick-a-tick: `{ts,n,bid,ask,value=(bid+ask)/2,volume,phase,round}`.
- Coleta: paginaÃ§Ã£o reversa (cap de ~3600 linhas/request) atÃ© cobrir 10,000h; pÃ¡ginas RAW preservadas (`raw-samples/`, originais completos em `raw2/` local e no Supabase).
- **OTC**: EUR/USD OTC (active_id=76) **existe publicamente** e foi extraÃ­do em dataset SEPARADO. Binary (active_id=1) e OTC **nunca sÃ£o misturados**.

## Janela e volumes
- Janela: 2026-09-15 07:01:19Z â†’ 17:01:18Z (10,000h; termina 35 min antes do fetch; Ãºltimos 30 min excluÃ­dos por regra oficial).
- BINARY: 104.805 ticks â†’ 7.201 candles 5s â†’ 7.171 linhas â†’ 399 janelas independentes (90s nÃ£o sobrepostas); 0 gaps > 5s.
- OTC: 141.103 ticks â†’ 7.201 candles â†’ 7.171 linhas â†’ 399 independentes; 0 gaps > 5s.
- MD5 (ts|bid|ask): binary `73fa63b8â€¦` (ver dataset-manifest.json); OTC `7d68e270â€¦`.

## MÃ©todo
- Candles de EXATAMENTE 5s (bucket = floor(ts/5000)*5000; preÃ§o = value/mid). Sem interpolaÃ§Ã£o; gaps apenas marcados.
- EstratÃ©gias CONGELADAS do Gauntlet (`finalists-manifest.json`, hash `2a49fb3eâ€¦`), zero retreino/threshold/otimizaÃ§Ã£o; compiladas com `gauntlet-compile.cjs` congelado.
- LiquidaÃ§Ã£o T+60: close do candle exatamente 12 buckets depois; WIN BUY: settle>entry; WIN SELL: settle<entry; iguais=DRAW; sem settlement=UNKNOWN.
- Features ESTRITAMENTE causais (v2; a v1 tinha leakage detectado pelo crÃ­tico â€” corrigido e re-verificado).

## Resultado â€” BINARY (WR T+60)
| EstratÃ©gia | Sinais | W/L | WR | BUY n/WR | SELL n/WR | Indep |
|---|---|---|---|---|---|---|
| and(fib_ctx,stoch_r_30) | 492 | 247/221 | 52,8% | 250/58,4% | 218/46,3% | 25/56,0% |
| and(struct_f,macd_r) | 1481 | 717/706 | 50,4% | 747/53,3% | 676/47,2% | 84/59,5% |
| gate(struct_f|expansion>1.3) | 526 | 234/276 | 45,9% | 240/47,9% | 270/44,1% | 39/48,7% |
| gate(struct_f|bullDiv) | 312 | 130/170 | 43,3% | 92/54,3% | 208/38,5% | 12/41,7% |
| baselines (always_buy/sell, random, last_candle) | â€” | â€” | 53,1% / 46,9% / 49,3% / 49,8% | | | |

**OTC**: 44,7%â€“52,4% (fib+stoch 47,7% n=491; struct+macd 49,3% n=1782) â€” sem edge.

## ComparaÃ§Ã£o com o HOLD interno
| EstratÃ©gia | Anterior (interno) | Binary 10h | Î”pp | OTC 10h | Î”pp |
|---|---|---|---|---|---|
| and(fib_ctx,stoch_r_30) | 63,7% (n=80) | 52,8% (n=492) | âˆ’10,9 | 47,7% (n=491) | âˆ’16,0 |
| and(struct_f,macd_r) | 62,2% (n=222) | 50,4% (n=1481) | âˆ’11,8 | 49,3% (n=1782) | âˆ’12,9 |
| gate(struct_f|expansion>1.3) | 59,4% (n=239) | 45,9% (n=526) | âˆ’13,5 | 44,7% (n=221) | âˆ’14,7 |
| gate(struct_f|bullDiv) | 70,7% (n=92) | 43,3% (n=312) | âˆ’27,4 | 49,1% (n=526) | âˆ’21,6 |

## CrÃ­ticos (independentes)
- 1Âº crÃ­tico: **FAIL** â€” detectou bug real de leakage (slices ancorados no fim do array) na avaliaÃ§Ã£o v1.
- 2Âº crÃ­tico (novo, pÃ³s-correÃ§Ã£o): **PASS 5/5** â€” 7.171/7.171 linhas sem divergÃªncia; mÃ©tricas reproduzem exato; hash congelado recompÃµe; T+60 correto; binary/OTC separados; teste condicional Ã  direÃ§Ã£o: nenhum finalista com delta positivo nos dois lados com nâ‰¥50.

## ConclusÃ£o
**Os finalistas NÃƒO mantiveram o edge** no feed oficial da IQ Option (binary e OTC). Vantagens internas de 62â€“75% nÃ£o generalizaram (43â€“53%, indistinguÃ­vel de baselines; o Ãºnico >55% Ã© `prod_v1fib` 62,0% n=148, dirigido pelo viÃ©s de alta da janela: BUY 67,2% vs base 53,1%). Exatamente o que a validaÃ§Ã£o externa deveria detectar.

## PersistÃªncia
- Supabase (projeto `cladmauwmuoeqongxzwb`, namespace `iqopt_*`): `iqopt_raw_ticks` 245.908 Â· `iqopt_candles_5s` 14.402 Â· `iqopt_decisions` 110.343 â€” `status=READY`, provenance em 100% dos ticks. Via Management API (`mgmt-persist.cjs`); gate de consistÃªncia antes de inserir (bate com results.json).
- ReproduÃ§Ã£o: `node run-all.cjs` (re-executa coleta+avaliaÃ§Ã£o) Â· `scripts/persist-run.log` = evidÃªncia da gravaÃ§Ã£o.
