# Relatorio experimental CONSENSUS — ultimas 4h

## Consensus (nova arquitetura)
- Decisoes persistidas: **125** · WAIT: **125** (100%) · aprovacoes (BUY/SELL): **0**
- Mercados com oportunidade RSI (73/28): **11** (linhas com estado de extremo: 18)
- Latencia por avaliacao: p50 **0ms** · p95 **1ms**
- Distribuicao: WAIT=118 · WAIT SELL=4 · WAIT BUY=3
- Top contra-evidencias: BOLLINGER_SEM_REJEICAO_REENTRADA=7 · PRICE_ACTION_SEM_REVERSAO=6 · RSI_ACELERANDO_COM_CONTINUACAO=5 · DMI_ADX_SEM_TRANSICAO=5 · DMI_ADX_TENDENCIA_ANTIGA_FORTALECENDO=4 · BOLLINGER_BAND_RIDING_CONTINUACAO=3 · PRICE_ACTION_CONTINUACAO=3

## Execucoes (por fonte)
- **agent-v2:RSI_REVERSAL_STRICT_V2:mcp-binary**: n=82 · W=42 L=40 D=0 abertas=0 · WR=51.22% · PnL=-6.36
- **agent-v2:RSI_EXTREME_PULLBACK_V2:mcp-binary**: n=4 · W=2 L=2 D=0 abertas=0 · WR=50% · PnL=-0.56
- **agent-v2:RSI_REVERSAL_STRICT_V2:RSI_REVERSAL_STRICT_V2**: n=2 · W=0 L=0 D=0 abertas=0 · WR=n/a · PnL=0

## Baseline V2 central (oportunidades aceitas)
- n=0 · W=0 L=0 · WR=n/a · PnL=0

> Amostra pequena nao prova edge. Instrumentacao apenas descritiva (evidenceStrength NAO e probabilidade).