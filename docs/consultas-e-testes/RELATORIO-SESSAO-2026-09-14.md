# Relatório da Sessão — 2026-09-14 (TraceCom Shadow Experiment)

## Missão da sessão

Validar as melhores estratégias de reversão do experimento shadow (10.000 trades, 1.000 inicial → expandido para 10.000), descobrir a abordagem com maior taxa de acerto e testá-la com 100 trades forward em EUR/NZD OTC.

## 1. Validação `shadow-reversion-v6` (missão final)

- **Estratégia**: reversão em RSI(14) profundo — banda |s| ∈ [0,63; 0,857] (i.e., RSI ≈ 16–27 para BUY / 83–94 para SELL), vol < 0,0009, horizonte **T+45s**.
- **Descoberta**: análise de 1.368 trades históricos de reversão.
  - Curva de timing da banda profunda: T+30s = 69,7% (n=165) · **T+45s = 79,0% (n=167)** · T+60s = 74,1% (n=170).
  - Validação fora da amostra: `reversion-v1` 71,7% (n=60; metades 76,3%/63,6%) e `reversion-v2` 71,9% (n=57; metades 73,2%/68,8%).
  - Extremo insano (conf ≥ 0,80) falha consistentemente (~18%) — excluído.
- **Teste forward EUR/NZD OTC (em andamento no momento deste relatório)**:
  - **60/100 trades · 34W / 17L / 1D / 8U = 66,7%** (IC95 inferior 53,0%)
  - Referência EUR/USD: 50,0% (25W/25L em 53 trades, T+45 sem ajuste de ativo)
  - Pausado por queda do stream de captura (não é bug do motor).
- **Nota de governança**: o v6 não entrou no top-3 do freeze automático do discovery (Wilson); foi adicionado aos finalistas por **override explícito do owner** para completar o teste — registrado em `shadow_experiments.frozen_strategy_versions` com `ownerOverride: true`.

## 2. As 5 abordagens pesquisadas (dados reais de discovery)

| Estratégia | Discovery N | WR discovery | Observação |
|---|---|---|---|
| bollinger-rsi-v1 | 151 | 60,2% | maior WR bruto (N insuficiente p/ veredito) |
| reversion-v6 | 94 | 55,4% | finalista por override (validação em curso) |
| snapback-v1 | 242 | 54,4% | finalista congelado |
| dual-rsi-v1 | 521 | 52,0% | finalista congelado (1º por Wilson) |
| reversion-v1 | 944 | 50,9% | finalista congelado |
| macd-rsi-v1 | 83 | 50,7% | —
| pullback-v1 | 32 | 48,1% | gate restritivo, poucos sinais |

## 3. Lição estatística central (padrão comprovado 4x)

Win rates de amostra pequena **sempre colapsaram** na validação forward:
- reversion-v3: 72,7% (N=14) → 50,0% (N=69)
- snapback: 83,3% (N=13) → 50,0% (N=102)
- macd-rsi: 87,5% (N=8) → 54,3% (N=38)
- v6 EUR/USD: 76,9% (N=28) → 46,8% (N=50)
- v5: 75,9% → 48,1%

Conclusão operacional: **só considerar edge com N ≥ 100 e IC95 inferior > 50%**.

## 4. Infraestrutura (correções da sessão)

- Captura universal **ABA/JANELA/TELA** (permite compartilhar o app nativo da corretora) + recorte manual para superfícies não-aba.
- Detecção de **troca de ativo ao vivo** pelo agente (`ASSET_MISMATCH` + status) — o motor pausa e registra se o gráfico mudar de ativo.
- **Auto-sweep a cada 30 min**: recupera candles perdidos em deploys/restarts (backfill causal idempotente).
- **Horizonte por estratégia** (T+45 para v6; T+60 para as demais).
- Reconexão do Supabase (produção) e do relay Railway; estado refletido no endpoint `/api/shadow/experiment/status`.

## 5. Estado do experimento principal

- Fase: **VALIDATION_RUNNING** (~5.900/10.000 válidos no fechamento da sessão).
- Finalistas congelados no discovery 5.000: `dual-rsi-v1` (n=444), `reversion-v1` (n=766), `snapback-v1` (n=195) + `reversion-v6` (override).
- Broker side effects: **0**. Nenhuma promoção a produção.
