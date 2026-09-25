# TraceCom — Estratégia ativa e configuração (checkpoint vivo)

> **Estado operacional atual (2026-09-25):** `PULLBACK_4060_300_AGENTIC_V3` está ACTIVE/executable para mercados NORMAL pelo MCP oficial da IQ. A V2 abaixo é o registro congelado e mantém apenas histórico/estatísticas separadas. PRACTICE e REAL percorrem o mesmo fluxo V3; REAL continua desarmado até confirmação explícita.

> **Este documento é o "cofre" da configuração que está valendo.** Sempre que algo for alterado
> no sistema, atualizar aqui primeiro e gerar um novo backup (`scripts/backup-config.mjs`).
> Última atualização: **2026-09-22** — reconstrução controlada (binário OTC 300s, V2 agentic).

## 1. Estratégia ativa — PULLBACK_4060_300_AGENTIC_V2 (Binary OTC 300s)

**Escopo único do produto:** BINARY OTC, expiração de 300 segundos (bucket de 5 minutos), candle nativo de 5s da IQ, contexto de até 3h por ativo.

| Camada | Arquivo | Papel |
|---|---|---|
| Asset Context | `relay/intelligence/asset-context.mjs` | 3h time-based, pivôs causais, HH/HL/LH/LL, BOS/CHoCH, zonas, pullback |
| Feature Engine | `relay/intelligence/features.mjs` | 1 computação por atualização (RSI14, DMI/ADX14, Bollinger20/2, ATR, Price Action) |
| 5 Especialistas | `relay/intelligence/specialists.mjs` | RSI, DMI/ADX, Bollinger, ATR, PriceAction — todos com o MESMO AssetContext/FeatureSnapshot |
| Consensus | `relay/intelligence/consensus.mjs` | BUY/SELL/WAIT + thesis/blockers/invalidations (sem confidence) |
| Decision Snapshot | `relay/intelligence/decision-snapshot.mjs` | deep-freeze + hash SHA256 determinístico (300s obrigatório; WAIT recusado) |
| Asset Pipeline | `relay/intelligence/asset-pipeline.mjs` | por ativo: hydration PENDING/READY/PARTIAL/FAILED; WAIT nunca gera snapshot |
| Runtime Adapter | `relay/intelligence/runtime-adapter.mjs` | UMA inteligência por runtime; dedup de candle fechado; health |
| Caminho único | `relay/execution/single-path.mjs` | DecisionSnapshot → Revalidation → Binary300Timing → ExecutionGate → AccountRouter |
| Timing | `relay/execution/binary300.mjs` | `OPERATIONAL_EXPIRY_SECONDS=300`; bucket de 5 min; deadline -5s; fail-closed |
| Gate | `relay/execution/execution-gate.mjs` | status != ACTIVE → DENY; researchOnly → DENY; BINARY only; REAL fail-closed |
| Roteador | `relay/execution/account-router.mjs` | PRACTICE/REAL decididos SOMENTE aqui; mesma decisão/fingerprint |
| Dispatch | `relay/execution/intelligence-dispatch.mjs` | decisions() → SinglePath → requestOrder (fronteira única de broker) |
| Persistência 5s | `relay/intelligence/candle-store.mjs` + migration 051 | candles nativos 5s (asset+interval+at), retenção 3h30, hydration cross-restart |

**Regras de entrada da V2:**
1. Estrutura UPTREND/DOWNTREND confirmada por swings; pullback SHALLOW/NORMAL ativo.
2. RSI em zona LOW/OVERSOLD (BUY) ou HIGH/OVERBOUGHT (SELL); DMI/ADX a favor; ATR operável.
3. Zero blockers (ADX_RANGE, ATR_EXPANDING, ATR_DEAD, STRUCTURE_THREATENING, CHOCH_AGAINST).
4. Saída apenas BUY/SELL/WAIT — nunca percentual de confiança.
5. Execução: 1 ordem por ativo, stake do painel, PRACTICE; REAL somente com arm explícito do operador (após deploy: `realArmed=false`).

**Identidade da V2 (congelada por código):**
- `strategyHash`: `sha256:3e9364e2d6e7b1e38ea3900a3a1c7a7e3be778978c8d4d0e563cbcb9645daeb0`
- Manifesto: `estrategias/strategy-versions/PULLBACK_4060_300_AGENTIC_V2.json` — **status ACTIVE, executable=true, FROZEN em 2026-09-23T11:38:37Z** (freeze em `PULLBACK_4060_300_AGENTIC_V2.freeze.json`)
- Regra de freeze: nenhum threshold/feature/especialista/consensus/readiness/3h/5s/300s muda. Mudança estratégica = `PULLBACK_4060_300_AGENTIC_V3` + novo strategyHash + novo statsEpoch. Mudanças operacionais (health/logs/infra/frontend/monitoramento) continuam permitidas.
- Parent (baseline congelada): `PULLBACK_4060_300_BASELINE` — `sha256:26dceb743b3f0d88a6bea10bf8646deb836236e3a7de91702bd323289438b3dd` (`archive/baseline/`)
- statsEpoch da V2: `2026-09-22T21:53:19.302Z` (N=0/W=0/L=0/D=0 até a primeira operação estratégica)

## 2. Configuração operacional (runtime)

- **Modo:** PRACTICE · conta REAL desarmada por padrão (fail-closed)
- **Expiração:** 300s única (`OPERATIONAL_EXPIRY_SECONDS`); 30/45/60/150/180 não têm capacidade de submit
- **Candle:** 5s nativo (`CANDLE_SIZE_SECONDS=5`); intervalo esperado 5000ms
- **Contexto:** 3h time-based (`MAX_CONTEXT_AGE_MS=10800000`)
- **Readiness:** min 25 observações, intervalo compatível (±50%), cobertura ≥ 3h−1 intervalo, gap ≤ 10× intervalo, gapRatio ≤ 2%
- **Broker:** `requestOrder` é a única fronteira; allowlist `OPERATIONAL_V2_PLUS_TEST_PATHS` (operacional `intelligence:*` + testes `pathtest:*`/`ui:smoke`/`agent-v2:*` PRACTICE-only)
- **Blitz:** extinto (capacidade zero)
- **Auto-tuning:** proibido — qualquer mudança futura = V3 + novo strategyHash + novo statsEpoch

## 3. Medição

- Estatísticas da V2 separadas: `GET /api/iq/strategy/stats?version=PULLBACK_4060_300_AGENTIC_V2` (exclui `excluded_from_stats=true`)
- PATH_TEST (`testOnly=true`, `excludedFromStats=true`) nunca entra em estatística
- Baseline mantém histórico próprio em `archive/baseline/PULLBACK_4060_300_BASELINE/stats-snapshot.json`


## Hotfix operacional — boot do relay (2026-09-24)


### Confirmação de autenticação e WS

- A tela só informa conexão confirmada quando o relay recebe `timeSync` válido do WebSocket; login HTTP aceito isoladamente não é sucesso operacional.
- Credenciais recusadas são exibidas como “E-mail ou senha não aceitos”; 2FA só é solicitado quando a IQ indicar verificação.
- A renovação da sessão encerra o socket anterior e inicia o handshake com o novo `ssid`, sem armar PRACTICE ou REAL.
- Corrigido o escopo de `v3RouterRoles`: helper no topo do módulo, fora de `IqMultiRuntime`; parsing e rotas preservados.
- `npm run build` agora verifica sintaxe de todos os módulos `.mjs` do relay, inclusive subdiretórios, antes do TypeScript. O deploy oficial executa esse build mesmo com `--skip-tests`.
- Sem alteração de stake, filtros, TTE 330→300, estratégia congelada ou gates de execução/REAL.
- Backup solicitado por AGENTS.md tentado: bloqueado por ausência de DATABASE_URL/SUPABASE_DB_URL neste ambiente. Backups anteriores preservados; executar backup no ambiente autenticado.
- Publicação e ciclo PRACTICE dependem de confirmação operacional pós-deploy; testes locais não comprovam ordem ou settlement.

## Hotfix operacional — multiplexação do WebSocket (2026-09-25)

- O cliente IQ correlaciona cada resposta pelo `request_id`; leituras paralelas de candles, opções, saldos e inicialização não substituem mais a espera umas das outras.
- Ao fechar o socket, todas as leituras pendentes falham imediatamente com `WS_CLOSED`, em vez de gerarem timeouts atrasados e rejeições não tratadas.
- Mudança exclusivamente operacional de transporte/observabilidade: não altera a estratégia congelada, stake, mercados, expiração de 300s ou os gates PRACTICE/REAL.

## Hotfix operacional — login IQ Option no painel (2026-09-25)

- A guia **Configurações** permite informar e-mail e senha da IQ Option para renovar a sessão do relay. O painel não recebe código de confirmação em duas etapas: quando a IQ exigir essa etapa, conclua o acesso pelo app ou site oficial e tente novamente.
- A senha segue somente no POST HTTPS de login, é limpa do formulário após o envio e não é gravada em armazenamento do navegador, logs, documentação ou backup. O relay persiste somente o `ssid` cifrado.
- Uma sessão aceita solicita a reconexão do WebSocket. Isso não arma PRACTICE, não arma REAL e não modifica estratégia, stake, mercados, expiração de 300s ou gates fail-closed.
## Hotfix operacional — feed NORMAL pelo MCP oficial (2026-09-25)

- Quando o WebSocket direto da IQ não sustenta uma sessão, o runtime usa somente o gateway MCP oficial para conta, catálogo NORMAL e candles. OTC permanece filtrado nesse caminho.
- O poller normaliza candles reais `from/to/open/max/min/close` e hidrata o buffer canônico de cada mercado; o feed só fica pronto com pelo menos 40 candles reais no buffer.
- A correção não modifica stake, expiração, estratégia congelada ou os gates PRACTICE/REAL. Qualquer ordem continua dependente de aprovação V3 e da configuração server-side do MCP.
