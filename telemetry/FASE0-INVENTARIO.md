# FASE 0 — INVENTÁRIO DO QUE RODA HOJE (antes de qualquer alteração)

Data: 2026-10-02 · Workspace: `D:\Tracecom project` · Branch: `main` · HEAD: `8e0277c`
Nada foi alterado nesta fase. Este documento é a fonte da verdade do "ANTES".

## 1. Código que roda

| Item | Descoberta |
|---|---|
| Runtime do bot | `node ws-otc-v15.mjs demo` (CLI puro) |
| Arquivo do motor | `ws-otc-v15.mjs` — 1539 linhas, 77.026 bytes, **untracked** (nunca commitado), `CODE_REV=V16`, hash impresso no boot: `bf1d085f` |
| Dependências do motor | `iqoption-ws.mjs` (só builtins: `tls`, `crypto`, `events`) + `bot-config-v15.json` + `bot-credentials.json` |
| Frontend do bot | **NÃO EXISTE** — só painel de terminal (odômetro de 1 linha) |
| Frontend do motor `relay/` | `src/http/public/grid.html` + `relay/server.mjs` — **produto DIFERENTE** (AGENTS.md §0.1 proíbe misturar backend/rotas) |
| Endpoints do bot | **NENHUM** |
| Processo agora | **parado** (nenhum `node ws-otc-v15` na lista de processos) |

## 2. Como ATIVAR/DESATIVAR funciona hoje

- **ATIVAR** = subir o processo: `node ws-otc-v15.mjs demo`.
- **DESATIVAR** = kill switch: tecla **K** (ou Ctrl+C / SIGINT / SIGTERM) → `shutdown(reason)` →
  `summary()` (relatório final) → `saveResults()` + `saveState()` → `process.exit(0)`.
- Sem reconexão: queda do WS (`ws.on('close')`) → `shutdown('WS')`.
- Existem ainda 2 paradas automáticas dentro do fluxo atual: meta de lucro (`stop.profitTarget`) e fim do processo.

## 3. Stake (mecanismo global existente)

- Fonte única no boot: `bot-config-v15.json` → `trading.baseStake` → const `BASE_STAKE` (2).
- `ladderStake(level)`: escada clássica **desligada** (`martingale.levels = 0`) → sempre `BASE_STAKE`.
- `martingaleStake(recoverBase)` = `2,75 × soma das posições vendidas por reversão` — **única ordem acima do stake fixo**.
  É decisão do dono, fica intocada e **invisível** no painel (sem controle/toggle).
- Tetos: `risk.maxStake` (30) por ordem; `risk.maxExposurePct` (50%) de exposição simultânea;
  `risk.maxSessionLossPct` (20%) de trava de perda da sessão.

## 4. Contas (PRACTICE/REAL)

- `demo` → conta `type === 4`; `real` → `type === 1`; sem argumento → `bot-credentials.json` ou pergunta no terminal.
- Conta usada: **DEMO (USD, id 1250741747)**. REAL existe no código, mesma lógica, e este painel **não** troca conta sozinho.

## 5. IQ / WS / ordens / settlement

- Login: HTTPS `api.iqoption.com/v2/login` → `ssid` → WS (`iqoption-ws.mjs`).
- Feed: `subscribeCandles(aid, 5s)` + `subscribeCandles(aid, 60s)`; candles **fechados** alimentam os buffers.
- Ordem: `maybeTrade()` → `sendMessage { name: 'binary-options.open-option' }` (fronteira única de broker).
- Fechamento normal: `parseSettlement(raw, op)` → `result: win|draw|loss` → `resultsList` + `registerOutcome` + `applyResult`.
- Venda antecipada (reversão confirmada): `sellOption()` → `finalizeEarly()` com `result: 'early'`,
  `profit = devolução − stake`, `profitSource: 'close_sell_return' | 'sell_quote'`.
- Persistência: `bot-state-v15.json` (estado por ativo) e `resultados-v15.json` (**somente o run corrente — sobrescrito a cada boot**).
- Resumo final no console (Ops/W/L/Draw/Vendas/WR/Lucro/saldo) — **não é persistido**.

## 6. O que o painel vai ler (aditivo, sem tocar no motor)

`bot-state-v15.json`, `resultados-v15.json` (somente leitura), log do processo e um snapshot
de telemetria novo (`telemetry/live.json`) publicado pelo próprio bot em um bloco marcado `[TELEMETRIA]`.
O mecanismo de stake NÃO muda: o painel escreve `trading.baseStake` (o mecanismo global existente)
e mostra sempre o valor **aplicado** (nunca um valor e outro em operação).

## 7. Prova de não-regressão

- `telemetry/proof/engine-before-v16-panel.mjs`: cópia byte-a-byte do motor ANTES (somente leitura).
- `telemetry/PROOF-ANTES.json`: retrato do motor (hash do arquivo, hash do motor "sem telemetria",
  56 constantes, 19 exports, 25 marcadores de fluxo, config completa sem credenciais).
- `telemetry/tools/proof-snapshot.mjs --compare`: compara ANTES × DEPOIS e falha se algo operacional mudar.
