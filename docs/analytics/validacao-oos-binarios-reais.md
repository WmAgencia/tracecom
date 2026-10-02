# Validação OOS dos binários REAIS (não-OTC) da IQ Option

Gerado: 2026-09-29T11:48:18.535Z · **somente leitura** · nenhuma ordem PRACTICE ou REAL foi enviada

> Escopo: **validar antes de implementar**. Nada aqui altera o Binary V3, o OTC Lab ou o Crypto V1.

## 1. Sumário executivo

**Nenhuma das hipóteses está validada.** A estrutura encontrada in-sample não sobreviveu a um teste cego com separação cronológica, e a amostra disponível é pequena demais para decidir qualquer coisa.

Três achados mudam o quadro:

1. **80% de todos os candles coletados eram duplicatas.** O coletor original fez append de janelas MCP sobrepostas sem deduplicar. Cada série tem ~1.000–1.080 barras **únicas**, não 5.000–7.000. Os `n` dos WRs in-sample anteriores estavam inflados por pseudo-replicação, e os intervalos de Wilson reportados eram estreitos de forma inválida.
2. **O produto padrão não oferece vencimento de 300s.** `binary-options` só negocia uma grade fixa de **900s (15 min)**. O horizonte de 300s do Binary V3 vive em `turbo-options` (grade de 60s) e `blitz-options` (`expiration_sizes_seconds` inclui 300 explicitamente).
3. **O instrumento do S&P 500 ETF (SPY) não existe mais no catálogo.** Nenhum dos 121 ativos de `binary-options` é um ETF. A hipótese H3 foi medida, mas **não é executável hoje**. O índice `US 500` (#1470), que é ofertado, não reproduz o resultado.

| hipótese | TRAIN | VALIDATION | BLIND OOS | eventos indep. | dias no teste | veredito |
|---|---:|---:|---:|---:|---:|---|
| UK 100 · 1m · RSI14 · h5 | 75.0% | 50.0% | 50.0% | 10 | 1 | **AMOSTRA_INSUFICIENTE** |
| US 2000 · 1m · RSI14 · h5 | 67.6% | 100.0% | 70.0% | 4 | 1 | **AMOSTRA_INSUFICIENTE** |
| S&P 500 ETF (SPY) · 1m · fade3 · h5 [INSTRUMENTO INDISPONÍVEL] | 65.3% | 61.3% | 61.8% | 29 | 2 | **POUCOS_DIAS_INDEPENDENTES** |
| US 500 · 1m · fade3 · h5 [SUBSTITUTO DECLARADO] | 58.5% | 52.5% | 53.7% | 23 | 1 | **POUCOS_DIAS_INDEPENDENTES** |

Regra de aprovação pré-registrada (congelada antes da coleta prospectiva): ≥100 eventos independentes, limite inferior do bootstrap acima do breakeven e EV>0 com o payout observado. **4 de 4 hipóteses não atingem nem o primeiro critério.**

## 2. Integridade dos dados (congelamento SHA-256)

Manifesto: `diagnostic-results/data/iq-real/FREEZE-MANIFEST.json` (+ `.md`). Nenhum CSV foi reescrito.

| hipótese | linhas brutas | barras únicas | duplicatas | conflitantes | span | gaps | sinais descartados (features/settlement) |
|---|---:|---:|---:|---:|---:|---:|---|
| H1-UK100-1m-rsi14-h5 | 4000 | 1052 | 2948 (74%) | 6 | 69.52h | 1 | 25/5 |
| H2-US2000-1m-rsi14-h5 | 5000 | 1052 | 3948 (79%) | 10 | 17.52h | 0 | 0/0 |
| H3-SP500ETF-1m-fade3-h5 | 7000 | 1078 | 5922 (85%) | 16 | 118.45h | 3 | 75/15 |
| H3b-US500-1m-fade3-h5 | 5000 | 1051 | 3949 (79%) | 10 | 17.5h | 0 | 0/0 |

**Consequência direta:** o `n` de cada hipótese nunca é o número de linhas do arquivo. O total real de informação é ~**37.270 barras únicas** para 36 séries — cerca de 17h de mercado em 1m por série.

O coletor foi reescrito para **deduplicar na escrita** (união por `from`, ordenada) e verificado: numa segunda passada sobre os mesmos dois ativos, 2.000 candles recebidos geraram apenas **+9 barras novas** e **1.991 duplicatas evitadas** (evidência: `diagnostic-results/oos/pipeline-verification.json`). O coletor antigo teria acrescentado as 2.000 linhas de novo.

Além disso, 12 das 36 séries foram resolvidas a um `asset_id` no catálogo atual; as **24 restantes são todas ETFs** — os mesmos instrumentos que sumiram da oferta.

## 3. Compatibilidade com o horizonte de 300s do Binary V3

Conversão correta conforme solicitado: `1m × h5 = 300s` ✓ · `5m × h1 = 300s` ✓ · `5m × h5 = 1.500s` ✗ (não é o horizonte V3).

O que o broker **realmente** oferece (catálogo MCP, leitura apenas):

| produto | ativos | esquema de expiração | passos observados | 300s ofertado? | payout min/med/max |
|---|---:|---|---:|---|---|
| binary-options | 121 | `expirations` (unix) | [900]s | **não** | 89/90/94% |
| turbo-options | 106 | `expirations` (unix) | [60]s | **sim** | 84/88/91% |
| blitz-options | 121 | `expiration_sizes_seconds` | [30,45,60,120,180,300,600,900] | **sim** | 87/89/91% |

**Leitura:** uma operação de 300s no `binary-options` não existe nesta API. O produto correto para o horizonte V3 é `turbo-options` (escolhendo o vencimento 5 minutos à frente na grade de 60s) ou `blitz-options` (tamanho 300s explícito). Isso não muda stake, ARM/AUTO nem o motor V3 — apenas onde a ordem seria enviada, o que continua **fora de escopo** nesta etapa.

Contagem: binary-options=121 + blitz-options=121 + turbo-options=106 = **348** "ativos" por produto, mas **132 ativos únicos** após deduplicar por `asset_id` (multiplicidade {"1":10,"2":28,"3":94}). Os totais por produto do levantamento anterior (91/51/74/67) também não eram ativos únicos.

## 4. Metodologia aplicada

- **dedupe**: por timestamp de abertura (`from`); a barra mais recente vence
- **splits**: {"train":0.5,"validation":0.25,"test":0.25}
- **purge**: nenhum sinal cuja janela de settlement cruze a fronteira
- **embargo_bars**: 1× horizonte após cada fronteira
- **gap_barrier**: sinais com features (i-25..i) ou settlement (i..i+h) não contíguos são eliminados
- **independent_events**: seleção greedy de janelas de settlement que não se sobrepõem
- **bootstrap**: stationary block bootstrap + block bootstrap por dias
- **multiple_testing**: {"hypotheses":4,"bonferroni_alpha":0.0125}

Preservação das garantias pedidas:

- **Sinais descartados por gap**, nunca interpolados: a janela de features (`i-25…i`) e a de settlement (`i…i+h`) precisam ser contíguas na resolução.
- **Purge + embargo**: nenhum sinal cuja janela atravesse a fronteira do split; embargo de 1× horizonte após cada fronteira.
- **Eventos independentes separados do total bruto**: seleção greedy de janelas de settlement que não se sobrepõem.
- **Bootstrap temporal** (blocos estacionários + blocos por **dias**), além do Wilson binomial — que é otimista quando as operações se sobrepõem.
- **Payout por produto**: o EV usa o payout do produto que oferta 300s, não 91% universal.
- **Multiplicidade**: 4 hipóteses testadas; α de Bonferroni = 0,05/4 = 0,0125.

## 5. Resultado por hipótese

### UK 100 · 1m · RSI14 · h5

`H1-UK100-1m-rsi14-h5` · MODEL_VERSION `db7f45fccadbe144ac5fc157` · horizonte operacional **300s** ✓ compatível com V3

| chave | valor |
|---|---|
| TRAIN_WR | **75.0%** (n=36) |
| VALIDATION_WR | **50.0%** (n=8) |
| BLIND_OOS_WR | **50.0%** (n=20) |
| PROSPECTIVE_WR | **aguardando amostra prospectiva** |
| RAW_SIGNALS | 64 |
| INDEPENDENT_EVENTS | 10 (WR independente 60.0% de n=10) |
| CONFIDENCE_INTERVAL | Wilson {"lower":0.33163455005521436,"upper":0.6683654499447856} · bootstrap em blocos [0.200, 0.700] · bootstrap por dias indisponível (1 dia(s)) |
| PAYOUT_OBSERVED | 91% (produto blitz-options) · por produto {"binary-options":91,"blitz-options":91,"turbo-options":90} |
| EV | **-4.5 por 100 stakes** (breakeven WR 52.4%) |
| DRAWDOWN_PAPER | 6.36 stake(s) no teste (20 operações) · 2.18 nos eventos independentes |
| DATA_GAPS | 1052 barras únicas de 4000 · 1 gaps · 30 sinais descartados |
| MARKET_AVAILABILITY | asset_id 1475 (UK 100), aberto=true, 300s em ["blitz-options","turbo-options"] |
| MODEL_VERSION | `db7f45fccadbe144ac5fc157ed0941aad9d1f0dcf91a6d95a5e48142c2b2f6db` |

**VEREDITO: AMOSTRA_INSUFICIENTE** — apenas 20 sinais no teste cego.

Sensibilidade de EV ao payout: 80%→-10 · 85%→-7.5 · 89%→-5.5 · 91%→-4.5 (por 100 stakes).

Baselines nas mesmas entradas elegíveis do teste cego: always_up 48.0% · always_down 52.0% · prev_direction 48.6% · simple_reversion 51.4% · train_majority 52.0% · no_indicator_model 48.6%. Melhor baseline: **always_down 52.0%**.

### US 2000 · 1m · RSI14 · h5

`H2-US2000-1m-rsi14-h5` · MODEL_VERSION `082d6c42727c828d1b333d18` · horizonte operacional **300s** ✓ compatível com V3

| chave | valor |
|---|---|
| TRAIN_WR | **67.6%** (n=37) |
| VALIDATION_WR | **100.0%** (n=2) |
| BLIND_OOS_WR | **70.0%** (n=10) |
| PROSPECTIVE_WR | **aguardando amostra prospectiva** |
| RAW_SIGNALS | 49 |
| INDEPENDENT_EVENTS | 4 (WR independente 100.0% de n=4) |
| CONFIDENCE_INTERVAL | Wilson {"lower":0.465525122625194,"upper":0.8234588098681593} · bootstrap em blocos [0.400, 0.900] · bootstrap por dias indisponível (1 dia(s)) |
| PAYOUT_OBSERVED | 91% (produto blitz-options) · por produto {"binary-options":91,"blitz-options":91,"turbo-options":89} |
| EV | **33.7 por 100 stakes** (breakeven WR 52.4%) |
| DRAWDOWN_PAPER | 3 stake(s) no teste (10 operações) · 0 nos eventos independentes |
| DATA_GAPS | 1052 barras únicas de 5000 · 0 gaps · 0 sinais descartados |
| MARKET_AVAILABILITY | asset_id 1473 (US 2000), aberto=true, 300s em ["blitz-options","turbo-options"] |
| MODEL_VERSION | `082d6c42727c828d1b333d187228b18c6a2366b5e990164c08ef46fc4f41243d` |

**VEREDITO: AMOSTRA_INSUFICIENTE** — apenas 10 sinais no teste cego.

Sensibilidade de EV ao payout: 80%→26 · 85%→29.5 · 89%→32.3 · 91%→33.7 (por 100 stakes).

Baselines nas mesmas entradas elegíveis do teste cego: always_up 47.2% · always_down 52.8% · prev_direction 47.2% · simple_reversion 52.8% · train_majority 52.8% · no_indicator_model 52.8%. Melhor baseline: **always_down 52.8%**.

### S&P 500 ETF (SPY) · 1m · fade3 · h5 [INSTRUMENTO INDISPONÍVEL]

`H3-SP500ETF-1m-fade3-h5` · MODEL_VERSION `8d9c9f6f1b7c898a5b75d448` · horizonte operacional **300s** ✓ compatível com V3

| chave | valor |
|---|---|
| TRAIN_WR | **65.3%** (n=124) |
| VALIDATION_WR | **61.3%** (n=75) |
| BLIND_OOS_WR | **61.8%** (n=55) |
| PROSPECTIVE_WR | **aguardando amostra prospectiva** |
| RAW_SIGNALS | 254 |
| INDEPENDENT_EVENTS | 29 (WR independente 65.5% de n=29) |
| CONFIDENCE_INTERVAL | Wilson {"lower":0.49420996437804365,"upper":0.7267221652717278} · bootstrap em blocos [0.418, 0.782] · bootstrap por dias indisponível (2 dia(s)) |
| PAYOUT_OBSERVED | **instrumento indisponível — sem payout** · por produto {} |
| EV | **11.3 por 100 stakes** (breakeven WR 55.6%) |
| DRAWDOWN_PAPER | 10.6 stake(s) no teste (55 operações) · 5.2 nos eventos independentes |
| DATA_GAPS | 1078 barras únicas de 7000 · 3 gaps · 90 sinais descartados |
| MARKET_AVAILABILITY | **não ofertado — direção mensurável, execução impossível** |
| MODEL_VERSION | `8d9c9f6f1b7c898a5b75d44816b065416a80c781bea45547ba5643923dadca88` |

**VEREDITO: POUCOS_DIAS_INDEPENDENTES** — o teste cego abrange 2 dia(s) — operações no mesmo dia são correlacionadas.

Sensibilidade de EV ao payout: 80%→11.3 · 85%→14.4 · 89%→16.8 · 91%→18.1 (por 100 stakes).

Baselines nas mesmas entradas elegíveis do teste cego: always_up 50.1% · always_down 49.9% · prev_direction 47.4% · simple_reversion 52.6% · train_majority 49.9% · no_indicator_model 52.6%. Melhor baseline: **simple_reversion 52.6%**.

### US 500 · 1m · fade3 · h5 [SUBSTITUTO DECLARADO]

`H3b-US500-1m-fade3-h5` · MODEL_VERSION `4349fb03c90ac672ce1ed6f5` · horizonte operacional **300s** ✓ compatível com V3

| chave | valor |
|---|---|
| TRAIN_WR | **58.5%** (n=106) |
| VALIDATION_WR | **52.5%** (n=59) |
| BLIND_OOS_WR | **53.7%** (n=54) |
| PROSPECTIVE_WR | **aguardando amostra prospectiva** |
| RAW_SIGNALS | 219 |
| INDEPENDENT_EVENTS | 23 (WR independente 52.2% de n=23) |
| CONFIDENCE_INTERVAL | Wilson {"lower":0.4145874305402977,"upper":0.6545669496981468} · bootstrap em blocos [0.370, 0.667] · bootstrap por dias indisponível (1 dia(s)) |
| PAYOUT_OBSERVED | 91% (produto blitz-options) · por produto {"binary-options":91,"blitz-options":91,"turbo-options":91} |
| EV | **2.6 por 100 stakes** (breakeven WR 52.4%) |
| DRAWDOWN_PAPER | 9.36 stake(s) no teste (54 operações) · 7 nos eventos independentes |
| DATA_GAPS | 1051 barras únicas de 5000 · 0 gaps · 0 sinais descartados |
| MARKET_AVAILABILITY | asset_id 1470 (US 500), aberto=true, 300s em ["blitz-options","turbo-options"] |
| MODEL_VERSION | `4349fb03c90ac672ce1ed6f5482e950bc12036e00374a3c3365852226ed913f3` |

**VEREDITO: POUCOS_DIAS_INDEPENDENTES** — o teste cego abrange 1 dia(s) — operações no mesmo dia são correlacionadas.

Sensibilidade de EV ao payout: 80%→-3.3 · 85%→-0.6 · 89%→1.5 · 91%→2.6 (por 100 stakes).

Baselines nas mesmas entradas elegíveis do teste cego: always_up 45.4% · always_down 54.6% · prev_direction 46.5% · simple_reversion 53.5% · train_majority 54.6% · no_indicator_model 54.6%. Melhor baseline: **no_indicator_model 54.6%**.

## 6. Diferenças entre histórico, teste cego e forward

| hipótese | in-sample (antigo) | TRAIN | VALIDATION | BLIND OOS | PROSPECTIVE |
|---|---:|---:|---:|---:|---:|
| H1-UK100-1m-rsi14-h5 | 70.1% (n=241) | 75.0% | 50.0% | 50.0% | aguardando |
| H2-US2000-1m-rsi14-h5 | 67.0% (n=597) *iShares Russell 2000* | 67.6% | 100.0% | 70.0% | aguardando |
| H3-SP500ETF-1m-fade3-h5 | 62.1% (n=1767) | 65.3% | 61.3% | 61.8% | aguardando |
| H3b-US500-1m-fade3-h5 | — (substituto declarado) | 58.5% | 52.5% | 53.7% | aguardando |

O `n` antigo era ~5× maior que a amostra real por causa das duplicatas. Quando o mesmo candle entra várias vezes, a estimativa pontual continua parecida, mas o intervalo de confiança fica artificialmente estreito — exatamente o que dava a falsa impressão de um 70% sólido.

## 7. SHADOW prospectivo

Congelamento: `forward-paper/iq-shadow/model-freeze.json`, gravado **antes** de qualquer coleta nova. O logger recalcula o SHA-256 de cada `MODEL_SPEC` e se recusa a iniciar se não bater.

| hipótese | produto de execução | payout congelado | instrumento ofertado |
|---|---|---:|---|
| H1-UK100-1m-rsi14-h5 | blitz-options | 91% | sim |
| H2-US2000-1m-rsi14-h5 | blitz-options | 91% | sim |
| H3-SP500ETF-1m-fade3-h5 | — | — | **não** |
| H3b-US500-1m-fade3-h5 | blitz-options | 91% | sim |

O log é `forward-paper/iq-shadow/shadow-predictions.jsonl` (append-only). Resolução **somente** com o candle cujo `from` é exatamente `entryBarTo + 300s`; ausência → `unresolved_gap`, nunca preço aproximado.

**Estado atual: zero previsões resolvidas.** Os gatilhos são raros (RSI14 fora de [30,70] ocorre em ~2% das barras), então a amostra prospectiva começa devagar por construção.

## 8. Limitações e o que seria necessário

- Histórico disponível por série ≈ 1000 barras únicas (~17h em 1m) por causa do teto de 1000 candles/chamada do MCP.
- O payout histórico não é recuperável: a IQ não expõe série histórica de profit_percent. EV histórico usa o payout observado hoje, com faixa de sensibilidade.
- O teste cego é pequeno; nenhuma conclusão de 70% é declarada sem amostra prospectiva.

Para sair deste ponto é preciso **acumular histórico para frente** (o teto é 1.000 candles por chamada, sem paginação) ou obter uma janela histórica maior do provedor. Com ~1.000 barras por série, o teste cego tem 1–2 dias independentes: nenhuma conclusão estatística é defensável, por maior que seja o WR pontual.

## 9. Artefatos e reprodução

```bash
# 1) congelar os dados (SHA-256, sem reescrever histórico)
node diagnostic-results/freeze_real_datasets.mjs
# 2) catálogo de ativos por produto (somente leitura; incremental e retomável)
IQ_MCP_TOKEN=... IQ_PRODUCTS=binary-options node diagnostic-results/iq_mcp_catalog.mjs
# 3) validação OOS (gera o congelamento dos modelos para o shadow)
npx tsx diagnostic-results/oos_validation.mts
# 4) relatório
node diagnostic-results/oos_report_md.mjs
# 5) shadow prospectivo (zero ordens)
IQ_MCP_TOKEN=... node forward-paper/iq-shadow/shadow_logger.mjs
```

| arquivo | papel |
|---|---|
| `diagnostic-results/freeze_real_datasets.mjs` | manifesto SHA-256 + integridade/gaps |
| `diagnostic-results/iq_mcp_scheduler.mjs` | agendador central, allowlist read-only, backoff, circuit breaker, checkpoint, dedupe por `asset_id` |
| `diagnostic-results/iq_mcp_catalog.mjs` | catálogo por produto com payout e expirações reais |
| `diagnostic-results/oos_validation.mts` | motor rigoroso + congelamento do modelo |
| `diagnostic-results/oos_report_md.mjs` | gera este relatório |
| `forward-paper/iq-shadow/shadow_logger.mjs` | coleta prospectiva read-only |
| `diagnostic-results/oos/oos-report.json` | resultado legível por máquina |
