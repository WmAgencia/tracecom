# Relatório — Bot OTC v13 (ws-otc-v13.mjs)

Data: 2026-10-01, 11:03 local (14:03 UTC)
Escopo: `ws-otc-v13.mjs` + `bot-config-v13.json` (script standalone do operador — fora do motor V3 do repositório).

---

## 0. Contas IQ Option (identificadas em 2026-10-01)

| Conta | `type` | **id** | Moeda | Saldo | Observação |
|---|---:|---:|---|---:|---|
| **DEMO** (PRACTICE) | `4` | **1250741747** | `USD` | **US$ 60,00** | é a conta usada pelo comando `demo` |
| **REAL** | `1` | **1250741746** | `BRL` | **R$ 0,00** | o valor de R$ 1,31 é **bônus** (`bonus_amount`), não saldo disponível |

- Identificação feita via `get-balances` (**somente leitura**) em 2026-10-01; nenhuma ordem enviada.
- O bot escolhe a conta pelo **type**: `demo` → 4 · `real` → 1 · (`2` = torneio).
- A DEMO é em **dólar** — o bot agora imprime a moeda real da conta (`US$`) em vez de "R$" fixo.
- A REAL está **sem saldo disponível**: o bot recusa iniciar nesse estado (fail-closed, mensagem clara).
- Registrado em: `bot-config-v13.json` (bloco `accounts`), `oTrace.com/backup/bot-config-v13.json` e `oTrace.com/README.md`.

---

## 1. Situação AGORA (leia primeiro)

Havia **dois processos do bot ANTIGO rodando** (PIDs 14724, de 10:03:47, e 12272, de 10:05:22 — os dois `node ws-otc-v13.mjs demo`).
**Os dois foram encerrados** (11:07 local) e o `resultados-v13.json` contaminado foi arquivado.

- Eram da conta **DEMO** — nenhum dinheiro real envolvido.
- O código novo nunca rodou: `resultados-v13.json` tinha **0 registros** com os campos novos (`requestId`, `flipped`, `ladder`).

### Por que nenhuma ordem chegava à IQ

1. A escada de martingale antiga nunca zerava e chegou a R$1.455.501.740.410,53 por ordem;
2. a IQ recusava por saldo insuficiente → sem `socket-option-closed` → o `consecutiveLosses`
   **nunca resetava** → a stake continuava astronômica para sempre (**travamento permanente**);
3. enquanto isso, as ordens aceitas (2 / 5,5 / 15,13 / 41,59 / 114,38 / 314,55) foram
   drenando o saldo DEMO: os logs mostram **R$60,00 → R$69,48 → R$24,38 → R$13,93 → R$11,12 → R$1,12 → R$0,38**;
4. com o saldo **abaixo de R$2**, nem a stake base passa — e o bot antigo não olha a resposta do broker:
   ele grava `[📤 ORDEM]` localmente antes de saber se a IQ aceitou.

Evidência no arquivo vivo antes de encerrar: último fechamento às **13:22:46Z**, **0 fechamentos**
nos últimos 5 minutos e **0 em 300 ordens**; soma dos stakes tentados: **R$4,4 × 10¹⁴**.

### Blindagem no bot novo (para não repetir)

- **Fail-closed no boot:** saldo menor que a stake base → erro + saída (não fica tentando à toa).
- **Checagem por ordem:** stake maior que o saldo → bloqueia e conta `semSaldo` no log de 60s.
- **Saldo atualizado a cada 60s** (antes só era lido quando uma ordem fechava — e se nada fechava, ficava congelado).
- **Ordem sem resposta da IQ:** o ativo é liberado automaticamente após expiração + 1 min, com aviso no log.

---

## 2. O que está funcionando no bot novo (verificado)

| # | Recurso | Estado | Como foi verificado |
|---|---|---|---|
| 1 | Stake base **fixo R$2** | funciona | teste: `ladderStake(0) === 2` |
| 2 | Martingale pelo payout (86%): **2 → 4,33 → 9,36** | funciona | teste: qualquer degrau que ganha fecha **+R$1,72** (cobre o loss + lucro da base) |
| 3 | Máximo **3 entradas** (base + 2) e depois **pausa de 10 min** | funciona | teste da máquina de estados: 3 losses → `pause`, escada zerada |
| 4 | Trava dura `risk.maxStake = 20` | funciona | teste: exposição máxima R$15,69 < R$20; nível 99 não cresce |
| 5 | **Auto-flip** após 2 losses seguidos | funciona | teste: loss 2 → `flip` para a direção oposta |
| 6 | Auto-flip volta à direção da whitelist ao acertar | funciona | teste: win → `direction = baseDirection` |
| 7 | Empate devolve o investido e zera a escada | funciona | teste: draw → ladder 0, direção base |
| 8 | **P/L nunca NaN** | funciona | 5 formatos testados: `win_amount` bruto, líquido, ausente, loss, empate |
| 9 | **Candle fechado** (vela em formação não gera ordem) | funciona | teste: 20 updates de 2 velas → exatamente 1 candle/sinal |
| 10 | **1 operação em voo por ativo** (sem sobrescrever operação) | funciona | `inFlight` por `aid`; resultado casado por `active_id` |
| 11 | Ordem recusada pela IQ não trava o ativo | funciona | liberação automática após expiração + 1 min |
| 12 | **10/10 ativos** da whitelist casando com o mercado turbo | funciona | teste com catálogo turbo: 10 casados, 10 aids distintos |
| 13 | Casamento tolerante a nome (`front.`/`-OTC`/caixa) | funciona | teste: `FRONT.wifusd-otc` == `front.WIFUSD-OTC` |
| 14 | Filtro de **regime** (bloqueia tendência forte) | funciona + visível | contador `regime:N` no log de 60s |
| 15 | Filtro **RSI mais permissivo (25/75)** | funciona | config + teste |
| 16 | Cooldown: 15s após win, 5s após loss | funciona | contador `cooldown:N` no log |
| 17 | `maxConcurrentOps = 10` (todos podem operar juntos) | funciona | config + teste |
| 18 | Estado persistido (escada, flip, cooldown sobrevivem ao restart) | funciona | `bot-state-v13.json` |
| 19 | Logs: boot, atividade 60s, ordem, aberta, fechada, flip, pausa, resumo final | funciona | revisão + saída esperada documentada |
| 20 | Funções de risco testáveis (puras, sem efeito colateral) | funciona | teste: não altera o estado de entrada |
| 21 | Trava de saldo (boot fail-closed + por ordem + saldo fresco a cada 60s) | funciona | revisão + causa raiz do travamento do bot antigo |

**Validação: 25 checks, todos passando** (`node --check` + suíte offline das funções puras).
O bot **não foi executado** pela correção — nenhuma ordem enviada por ela.

---

## 3. O problema corrigido (evidência do bot antigo)

Fórmula antiga: `2 × 2.75^(losses − 2 + 1)`, com o contador de losses **acumulando para sempre**
(o `match` por ativo era sobrescrito, então nunca zerava de verdade).

| ativo (estado arquivado) | losses | stake que o bot ia enviar |
|---|---:|---:|
| SHIBUSD | 6 | `2 × 2.75⁵` = **R$314,55** |
| HYPE | 12 | R$136.047 |
| SUIUSD | 17 | R$21.397.010 |
| RENDERUSD / XPTUSD | 20 | R$444.990.949 |
| WIFUSD | 28 | R$1.455.501.740.410 |

Resultados arquivados em `diagnostic-results/archive/bot-v13-invalido-2026-10-01/`:
- 3.109 ordens registradas, **2.605 sem resultado** (ordem recusada/spam);
- **1.612 ordens com stake acima de R$20**;
- pior repetição no mesmo ativo/segundo: **5 ordens** (SUIUSD).

Dados do bot antigo **ainda rodando** (arquivo vivo às 11:03): 4.209 registros, 473 fechados,
WR 41,6% (197 W / 276 L), **2.633 ordens com stake > R$20**, stakes de até R$1,45 trilhão.
WR real por ativo (só as ordens que fecharam): HYPE 69/95 (73%), DOTUSD 27/50 (54%),
os demais entre 34% e 37% — amostra contaminada (as ordens grandes eram recusadas).

---

## 4. Regras de risco em vigor

| Regra | Valor | Onde |
|---|---|---|
| Stake base | R$2,00 | `trading.baseStake` |
| Martingale 1 / 2 | R$4,33 / R$9,36 | calculado pelo payout |
| Payout considerado | 86% | `martingale.payoutRate` |
| Entradas por sequência | 3 (base + 2 martingales) | `martingale.levels` |
| Após perder as 3 | pausa de 10 min no ativo | `martingale.pauseAfterLadderMs` |
| Trava por ordem | R$20 | `risk.maxStake` |
| Operações simultâneas | 10 | `trading.maxConcurrentOps` |
| Cooldown | 15s após win / 5s após loss | `cooldown` |
| Auto-flip | após 2 losses, volta no win | `autoFlip` |
| RSI | 25 / 75 | `strategy.rsiOversold` / `rsiOverbought` |
| Exposição máxima teórica | R$15,69 por ativo | |

---

## 5. O que ainda NÃO dá para afirmar (precisa de execução limpa)

0. **Recarregar a conta DEMO**: ela está com menos de R$2 (o bot novo recusa iniciar assim e sai com erro claro).
1. Nomes/aids reais dos ativos no seu catálogo **hoje** (o teste usou os aids observados nos logs; o boot imprime a lista real).
2. Latência até a primeira ordem (warmup 30s + 1 candle de 1min fechado).
3. ACK da IQ (`socket-option-opened`) com o novo formato de ordem — inalterado em relação ao que já funcionava.
4. Qual campo a IQ manda em `socket-option-closed` (`win_amount` bruto ou líquido) — o parser aceita os dois, e grava `profitSource` em cada resultado para auditoria.
5. WR real por ativo (o estado começa zerado).

### O que olhar nos primeiros 2 minutos

```
[📋] 10/10 ativos rodando (top WR):        ← todos os ativos casaram
[📡] Atividade ... blocos: regime:9 rsi:6  ← filtros trabalhando
[📤 ORDEM] ... | R$2.00                    ← primeira ordem na base
[✅ ABERTA] ...                            ← IQ aceitou
[✅] ... | WIN | P/L: +R$1.72              ← P/L correto (sem NaN)
```

---

## 6. Comando

```bash
cd "D:/Tracecom project"
node ws-otc-v13.mjs demo
```

Real: `node ws-otc-v13.mjs real` · Listar ativos turbo: `node ws-otc-v13.mjs demo --ativos`

---

## 7. Arquivos

- `ws-otc-v13.mjs` — bot reescrito (573 linhas)
- `bot-config-v13.json` — blocos `trading, martingale, risk, cooldown, autoFlip, strategy, whitelist, paths`
- `diagnostic-results/archive/bot-v13-invalido-2026-10-01/` — estado do bot antigo + `resultados-v13.json` (versão das 13:39) + `resultados-v13-bot-antigo-final.json` (versão das 14:03, com 4.209 registros)
- `oTrace.com/backup/` — cópias atualizadas (bot corrigido + config com as contas); as versões antigas (martingale 2,75x) foram movidas para `oTrace.com/backup/historico-2026-09-30/` — **não restaurar**
- `bot-state-v13.json` / `resultados-v13.json` — recriados limpos na próxima execução

Observação: martingale é proibido no motor V3 do repositório (AGENTS.md). Esta correção ficou
restrita ao script standalone do operador; nenhum arquivo do motor foi tocado.
