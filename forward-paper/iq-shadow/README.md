# SHADOW prospectivo — binários REAIS da IQ Option

Coleta de amostra **prospectiva** para os modelos congelados na validação OOS.
Nenhuma ordem PRACTICE ou REAL é enviada em nenhum caminho de código: o allowlist
do `Scheduler` (`diagnostic-results/iq_mcp_scheduler.mjs`) recusa `place_trade`,
`place_market_order`, `sell_position` e qualquer outra escrita **antes** de sair
do processo.

## Por que existe

A validação OOS mostrou que o histórico disponível só permite ~1.000 barras
únicas por série (teto de 1.000 candles por chamada do MCP). Isso é pequeno
demais para decidir qualquer coisa: cada hipótese tem no máximo 1–2 **dias**
independentes no teste cego. A única forma honesta de aumentar a amostra é
acumular dados **para frente**, com o modelo já congelado.

## Congelamento

`model-freeze.json` é gerado por `diagnostic-results/oos_validation.mts` **antes**
de qualquer coleta prospectiva. Para cada modelo ele registra:

- `MODEL_VERSION` — SHA-256 do `MODEL_SPEC` (sem hash de dados, para ser estável);
- `MODEL_SPEC` — setup, horizonte, resolução, limiares, warmup, split, embargo, seed;
- `candle_source_product` — servidor usado só como fonte de candles;
- `execution_product` — produto onde o vencimento de **300s** existe de fato;
- `payout_execution` — payout observado nesse produto no momento do congelamento;
- `market_availability` — se o instrumento está realmente ofertado.

O logger recalcula o SHA-256 de cada `MODEL_SPEC` e **recusa iniciar** se não
bater. Assim a amostra prospectiva pertence exatamente ao modelo avaliado — sem
ajuste retrospectivo de parâmetros.

## Regra de aprovação pré-registrada

Nenhuma hipótese é declarada validada sem:

1. ≥ **100 eventos independentes** (janelas de 300s que não se sobrepõem);
2. limite inferior do **bootstrap por blocos de dias** acima do breakeven WR do
   payout observado no instante do sinal;
3. **EV > 0** com esse payout (nunca com 91% universal);
4. resultado consistente entre histórico, teste cego e prospectivo.

## Como rodar

```bash
# 1) regenerar o congelamento (só quando o modelo mudar de verdade)
npx tsx diagnostic-results/oos_validation.mts

# 2) iniciar o logger (fica em loop; Ctrl+C para parar)
IQ_MCP_TOKEN=... node forward-paper/iq-shadow/shadow_logger.mjs

# ciclo único, útil para verificar
IQ_MCP_TOKEN=... IQ_SHADOW_MAX_CYCLES=1 node forward-paper/iq-shadow/shadow_logger.mjs
```

Variáveis:

| variável | padrão | efeito |
|---|---|---|
| `IQ_SHADOW_POLL_MS` | `60000` | intervalo entre ciclos (1 ciclo vê cada barra de 1m) |
| `IQ_SHADOW_MAX_CYCLES` | `0` | `0` = infinito |
| `IQ_SHADOW_DIR` | `forward-paper/iq-shadow` | pasta de trabalho |

O gateway MCP tem limite **global** de 60 leituras/min compartilhado entre todos
os produtos; o agendador serializa tudo, aplica jitter e abre o circuit breaker
quando o servidor degrada. Em ciclo normal são ~3 leituras por minuto.

## Formato do log

`shadow-predictions.jsonl` é **append-only**. Cada previsão gera um registro
`pending` e, quando vence, um **novo** registro com o desfecho — a revisão nunca
reescreve a previsão original (trilha de auditoria). Campos principais:

```jsonc
{
  "kind": "prediction",
  "hypothesisId": "H1-UK100-1m-rsi14-h5",
  "MODEL_VERSION": "db7f45fc…",
  "candle_source_product": "binary-options",
  "execution_product": "turbo-options",
  "asset_id": 1475, "assetName": "UK 100",
  "direction": "up",
  "entryBarFrom": "2026-09-29T11:42:00Z",   // barra fechada usada como sinal
  "entryClose": 10725.9,
  "loggedAtUtc": "…",                       // ANTES de T+300s
  "loggedBeforeExpiryMs": 51234,            // margem até o vencimento
  "payoutAtSignal": 90,                     // payout OBSERVADO no instante
  "expiryTargetUtc": "2026-09-29T11:47:00Z", // entryBarTo + 300s
  "resolvedOutcome": "pending",             // pending | hit | miss | unresolved_gap
  "ordersPlaced": false
}
```

## Regra de resolução

A previsão é resolvida **somente** com o candle cujo `from` é exatamente
`entryBarTo + 300s`. Se esse candle não existir (feriado, gap, sessão fechada),
a previsão é marcada `unresolved_gap` após ~45 min — **nunca** é resolvida com
preço aproximado ou de barra vizinha.
