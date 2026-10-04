# V22 — plano aprovado: contexto 30 minutos e pullback confirmado

Base auditada: 66cb285. Escopo: bot standalone ws-otc-v21.mjs (identificado como V22), sem mudanças no motor relay.

## Relatório anterior à implementação

1. Carregar 30 minutos completos de candles 5s e pelo menos 60 candles 1m no bootstrap. Não aguardar 30 minutos ao iniciar. Bloquear dados incompletos, atrasados ou com lacunas.
2. Substituir o regime em cache de candles 15m por contexto móvel dos últimos 30 candles fechados de 1m. Contexto não é timeframe: 30 minutos de histórico não são uma vela de 30 minutos.
3. Separar contexto de 30 minutos e direção recente de 1m; exigir alinhamento da tendência 5s no gatilho. Recalcular com dados atuais, sem cache direcional de 15 minutos.
4. Mapear zonas por pivôs já confirmados, sem olhar candles futuros. Exigir pullback recente na zona e retomada confirmada por preço e RSI. Não comprar só porque o RSI caiu nem vender só porque subiu.
5. Normalizar distâncias por ATR real, conferir DI na direção da ordem e usar RSI Wilder (flat=50). Remover do caminho de entrada filtros contraditórios de corpos/padrões e tolerância Bollinger de 5% do preço.
6. Configurar expiração de cinco minutos; manter Cash/Runner e controles financeiros existentes. Registrar duração real do contrato e versão estratégica. Não confundir expiração alinhada do broker com exatamente 300 segundos após envio.
7. Desativar recuperação por padrão e impedir recuperação clássica nesta estratégia. Avaliar primeiro a entrada sem aumento de stake. Eventual reativação antecipada exige configuração explícita e nova validação da estratégia.
8. Testar sem login/ordens: dados antigos/lacunas, alta e baixa, veto contra tendência, ausência de reação, causalidade dos suportes e integração. Criar backup sem credenciais e commit em branch isolada.

## Limites da entrega

Não há promessa de aumento de WR. Testes funcionais não são backtest nem validação em conta real. Comparação de 2 versus 5 minutos deve usar mesmos sinais, payout e datas fora do ajuste. Medir P/L, drawdown e exposição além de WR; gêmeas não são amostras independentes. Bugs de liquidação/exposição fora deste escopo não são certificados por esta alteração.

## Implementação entregue

| Arquivo | O que procurar |
|---|---|
| `v22-context.mjs` | `validWindow`, `context30`, `zones`, `entryPullback`, `rsiWilder`, `dmi`, `expirationAllowed`: inteligência pura, sem broker |
| `ws-otc-v21.mjs` | `getRegimeForAsset` recalcula contexto; `evaluateEntry` inclui janela temporal; `planTrade` carrega snapshot; `maybeTrade` veta duplicata e prazo curto; `sendOrder` registra identidade e decisão |
| `bot-config-v21.json` | `trading.expirationMinutes=5`, `recovery.enabled=false`, configuração da estratégia |
| `diagnostic-results/v22-context-tests.mjs` | testes comportamentais offline, incluindo wrapper real e envio das gêmeas com transporte simulado |
| `diagnostic-results/bot-v21-tests.mjs` | verificações estruturais mantidas do código operacional |
| `backups/v22-context30/` | cópias do código, config sem login, testes, relatório e manifest SHA256 |

### Regras exatas desta versão

- Busca 362 candles 5s e 62 candles 1m para dispor de pelo menos 360/60 fechados, descartando a vela em formação pela rotina de ingestão. Exige continuidade e OHLC válido; se houver lacuna, não considera o ativo pronto. Não promete quantidade mínima de entradas.
- Contexto: EMA8/21 dos últimos 30 candles 1m, spread mínimo 0,01% e inclinação da EMA8 em três candles. Direção recente: EMA8/21 nos últimos 10 candles 1m, spread mínimo 0,005%. Gatilho: EMA8/21 nos últimos 50 candles 5s, spread mínimo configurado (0,01%). Os três devem concordar. Os enums legados `alta15m/baixa15m` permanecem só por compatibilidade do estado; a fonte é `context30-1m`.
- Pivôs: mínimo/máximo local com dois candles de cada lado já fechados. Só são usados se estavam confirmados antes da janela de pullback. São zonas candidatas, não garantia de reversão. ATR Wilder 1m define tolerância de toque (0,35 ATR), invalidação (fechamento além de 0,5 ATR) e distância máxima da entrada (1,5 ATR). Obstáculo oposto a menos de 0,5 ATR bloqueia.
- Pullback: RSI 5s atingiu até 45 para CALL ou pelo menos 55 para PUT em algum dos 12 candles anteriores. Retomada: RSI muda a favor e retorna para 45–70 (CALL) ou 30–55 (PUT); vela fecha na direção e rompe a máxima/mínima da anterior. ADX mínimo 20 e DI correspondente dominante. Esses limiares são hipóteses iniciais, não otimizados por backtest.
- Expiração: mantém contrato turbo da integração existente, no próximo múltiplo de cinco minutos. Só admite envio se restarem 240–300 segundos. A janela fica aproximadamente no primeiro minuto de cada bloco de cinco; sinais fora dela são descartados, não ficam em fila. O prazo contado até o ACK será um pouco menor pela latência. Não foi validado com IQ ao vivo.
- Gêmeas: Cash e Runner permanecem com stake base configurada. Cash mantém sua saída antecipada anterior, portanto pode durar menos que o contrato; não atribuir seu WR a cinco minutos fixos. Recovery não tem caminho de envio nesta estratégia; `enabled=true` causa erro explícito, em vez de reativar o algoritmo antigo silenciosamente. Posições legadas existentes continuam tendo settlement processado.
- Resultado registra `strategyVersion`, `decisionSnapshot`, suporte/resistência escolhido, indicadores, direção e duração planejada. Estatísticas anteriores no arquivo não são evidência desta versão: filtrar por `strategyVersion=V22_CONTEXT30_PULLBACK_5M` e separar conta, ciclo e papel.

### Como executar e conferir

No PowerShell, com o bot anterior parado e a branch desta entrega atualizada:

```powershell
Set-Location -LiteralPath 'D:\Tracecom project'
node --test diagnostic-results/v22-context-tests.mjs
node diagnostic-results/bot-v21-tests.mjs
node ws-otc-v21.mjs demo
```

O boot deve mostrar `V22_CONTEXT30_PULLBACK_5M`, hash do código+módulo+config estratégica, `Recovery OFF`, contexto 30m e prazo 240–300s. O arquivo ainda se chama `ws-otc-v21.mjs`; não existe novo comando `ws-otc-v22.mjs`.

Saídas: caminho de resultados definido em `paths.results` do config; nome/caminho do log aparece no terminal no início da sessão. Registros de ordem incluem o snapshot; diagnóstico usa a mesma função de entrada. Não editar/apagar arquivos de posições pendentes para iniciar a versão.

### Verificação realizada

- 14 testes comportamentais passaram: CALL/PUT, contexto, RSI/DI, timestamps, pivôs causais, bloqueios, janela de expiração e integração de `maybeTrade` com transporte simulado.
- 56 verificações estruturais herdadas passaram. Foram retirados 29 checks textuais que exigiam a estratégia anterior (recovery ativa, 15m em cache, RSI entrando no extremo, BB e corpo); substituídos pelos testes de comportamento acima. Não são 70 testes de performance ou broker.
- Importação do bot sem login, sintaxe e análise de variáveis não definidas verificadas. Nenhuma operação/login/restart de conta executado.
- Falta validar em DEMO a aceitação dos contratos pela IQ, histórico entregue, latência e resultados fora da amostra. Sem benchmark de capacidade de todos os ativos e sem afirmação de melhoria do WR.

### Credenciais

O repositório é público. Login/senha foram removidos do config versionado. Use `bot-credentials.json` local (campos `email` e `password`, ignorado pelo Git) ou variáveis `IQ_EMAIL`/`IQ_PASSWORD`. O arquivo local tem preferência quando contém ambos. Se credenciais reais já estavam em commits anteriores, trocar a senha é necessário; remover do arquivo atual não apaga o histórico.
