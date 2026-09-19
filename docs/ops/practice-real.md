# PRACTICE x REAL — contexto de conta, isolamento e LOCKED/ARMED (Trilha B)

Documento operacional das fases 19–25 e 36–37. **Nenhuma ordem REAL é enviada
durante o desenvolvimento**; REAL nasce `LOCKED` e só executa com armamento
explícito do operador + todas as condições do gate.

## Conceito

- `accountContext ∈ {PRACTICE, REAL}` é o isolamento rigoroso de conta.
- Toda entidade carrega `accountContext`: candidate, analysis, decision,
  execution, ACK, settlement, journal, PnL, audit e eventos.
- Uma operação criada em PRACTICE **nunca** atravessa para REAL (e vice-versa).
- Saldo, posição, PnL e journal são filtrados por contexto em todos os
  endpoints; `portfolioSnapshot(context)` expõe `byContext` separado.
- O contexto ativo é exibido na top bar do Office (`PRACTICE ⇄ REAL`) e o
  `office()` sempre devolve `accountContext.state` = `PRACTICE`,
  `REAL · LOCKED` ou `REAL · ARMED`.

## Estados REAL

| Estado | Significado |
| --- | --- |
| `PRACTICE` | Conta prática, padrão do sistema. |
| `REAL · LOCKED` | Conta real selecionada, somente leitura, execução proibida. |
| `REAL · ARMED` | Operador confirmou o armamento nesta sessão; execução permitida **somente** com todos os checks PASS. |

REAL de verdade é **somente leitura** (fase 21): ao selecionar REAL o relay lê a
conta real no broker (`get_balances`), mostra saldo real, valida autenticação e
sincroniza posições/estado. Se a conta não estiver acessível, a UI mostra erro
honesto (`REAL_ACCOUNT_UNAVAILABLE`) e **não simula saldo**.

## Gate de envio REAL (fail-closed)

Uma ordem REAL exige **todas** as condições abaixo; qualquer falha => `BLOCK`:

1. `accountContext = REAL`
2. `REAL_TRADING_ENABLED=true` (env server-side; default `false`)
3. `ARM=true` (confirmação explícita da sessão)
4. `killSwitch = OFF`
5. `riskGate = PASS` (exposição/posições dentro do limite)
6. `dataQuality = HEALTHY` (WS conectado + relógio válido)
7. `strategy ∈ REAL_STRATEGY_ALLOWLIST`
8. `stake <= hardCap`
9. `market allowed` (habilitado e OPEN)
10. `idempotency valid` (chave nova, sem duplicidade)
11. `accountAccessible` (conta real lida no broker)
12. `accountUnambiguous` (balanceId resolvido, sem ambiguidade)

Endpoint de leitura: `GET /api/iq/real/preflight` devolve `PASS`/`BLOCK` com a
lista de checks que falharam.

## Primeira ativação por sessão

Na primeira ativação, o Office exige confirmação explícita (`CONTA REAL`):
saldo real, stake máximo, exposição máxima, posições máximas, strategy, status
do AUTO e o botão **CONFIRMAR E ARMAR REAL** (frase literal aceita pelo
servidor). Depois de armado, não há confirmação por operação.

## FAIL CLOSED

Após **restart/deploy/reconnect/token refresh/session change/account
ambiguity**, REAL volta a `LOCKED`. `ARMED` **nunca** é persistido nem
restaurado automaticamente. Kill switch desarma e revoga REAL imediatamente.

## Allowlist de estratégia (fase 25)

`REAL_STRATEGY_ALLOWLIST` é congelada em código:

- Elegível: `PROFESSIONAL_BRAIN_G2` (Brain validado).
- Permanecem **SHADOW** (nunca executam): `SCENARIO_ENGINE_V3_FROZEN`,
  `AGENT_V4`, `LATE_WINDOW_V2`, `ALPHA_PACK_V1`, `ML_SHADOW`,
  `NEW_PLAYBOOKS_V1`.

Nenhuma estratégia experimental ganha permissão por existir. A conta REAL pode
ser selecionada e visualizada; a infraestrutura fica pronta.

## Auditoria (fase 36)

Toda tentativa REAL gera trilha (`iq_audit_trail` + buffer do controller) com:
`accountContext`, `strategy`, `agentVersion`, `candidateId`, `decisionId`,
`stake`, `marketKey`, `direction`, `expiry`, `send`, `ack`, `brokerOrderId` e
`settlement`. Logs são redigidos: segredos (senha/SSID/token/cookie/chave)
nunca entram em frontend, DOM, log ou doc.

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/iq/account/context` | Contexto ativo + contas (PRACTICE/REAL, somente leitura). |
| POST | `/api/iq/account/select` | Seleciona `PRACTICE` ou `REAL` (REAL entra LOCKED). |
| GET | `/api/iq/real/preflight` | Checks do gate REAL (`PASS`/`BLOCK`). |
| POST | `/api/iq/real/arm` | Arma REAL (frase `CONFIRMAR E ARMAR REAL` + acknowledge). |
| POST | `/api/iq/real/disarm` | Desarma REAL (LOCKED). |

Filtros `accountContext` também são aceitos em `/api/iq/executions`,
`/api/iq/signals`, `/api/iq/journal` e `/api/iq/audit`.

## Persistência

Migration `relay/migrations/033_practice_real_account_context.sql`:

- `iq_executions.account_context` (default `PRACTICE`) + índice;
- `iq_audit_trail.account_context` + índice;
- `iq_account_context` (contexto ativo persistido; `real_locked=true` sempre no
  boot — ARMED não é persistido).

## Testes

`tests/ai/account-context.test.ts` (45 testes) cobre: isolamento, transições
PRACTICE→REAL e REAL→PRACTICE, candidate que não atravessa conta, journal/PnL
sem mistura, restart desarmando REAL, reconnect revalidando, kill switch, ARM,
`REAL_TRADING_ENABLED`, hard cap, risk gate, allowlist, agente experimental
bloqueado, shadow que nunca executa, duplicidade/idempotência, expiry mismatch e
ambiguidade de conta — tudo com client fake e **zero ordem REAL**.

## Operação

1. Selecione `REAL` na top bar (somente leitura; saldo real aparece).
2. Confira preflight; se `BLOCK`, corrija o item listado.
3. Marque `RISCO ACEITO` e clique `CONFIRMAR E ARMAR REAL` (exige
   `REAL_TRADING_ENABLED=true` no relay).
4. `DESARMAR REAL` a qualquer momento; qualquer queda de WS também desarma.
