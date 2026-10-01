# Bot OTC — Manual do Operador

> Arquivo: `README.bot.md` | Versão: 15 | Data: 2026-10-01
>
> Este é o manual do **bot standalone** (`ws-otc-v15.mjs`). Ele é **separado** do motor oficial
> da Tracecom (estratégia V3 congelada em `AGENTS.md`). As regras de lá (ex.: martingale
> proibido) **não se aplicam** a este script.

---

## Índice

1. [Como rodar](#1-como-rodar)
2. [Contas: Demo e Real](#2-contas-demo-e-real)
3. [Arquivos do bot](#3-arquivos-do-bot)
4. [O que o bot faz, passo a passo](#4-o-que-o-bot-faz-passo-a-passo)
5. [Filtros e regras de entrada](#5-filtros-e-regras-de-entrada)
6. [Sistema de gale (martingale)](#6-sistema-de-gale-martingale)
7. [Venda antecipada (Early Sell)](#7-venda-antecipada-early-sell)
8. [Circuit breaker e proteção](#8-circuit-breaker-e-proteção)
9. [Painel (o que aparece na tela)](#9-painel-o-que-aparece-na-tela)
10. [Configurações principais](#10-configurações-principais)
11. [Como atualizar a configuração](#11-como-atualizar-a-configuração)
12. [Testes offline](#12-testes-offline)
13. [Debugging](#13-debugging)
14. [Problemas já resolvidos (não repetir)](#14-problemas-já-resolvidos-não-repetir)

---

## 1. Como rodar

```bash
cd "D:/Tracecom project"

# Rodar na DEMO (conta prática)
node ws-otc-v15.mjs demo

# Rodar na REAL
node ws-otc-v15.mjs real

# Perguntar qual conta (1 = REAL, 2 = DEMO)
node ws-otc-v15.mjs

# Listar os ativos turbo disponíveis (sem operar)
node ws-otc-v15.mjs demo --ativos
```

**Reiniciar sempre depois de qualquer alteração no código ou configuração.**

No boot aparece `[🧬] CÓDIGO V15 sha256:xxxxxxxx` — se mostrar outro hash, é código velho.

---

## 2. Contas: Demo e Real

O bot identifica as contas pela API da IQ Option:

| Tipo | ID da Conta | Nome na IQ | Moeda |
|------|------------|-----------|-------|
| **4** | `1250741747` | PRACTICE | USD |
| **1** | `1250741746` | REAL | BRL |

- **PRACTICE (tipo 4)**: é a conta demo que você usa para testar. Saldo de US$60.
- **REAL (tipo 1)**: é a conta com dinheiro de verdade. Em 2026-10-01 o saldo disponível era R$0,00 (R$1,31 de bônus).

O bot escolhe a conta automaticamente pelo argumento (`demo` ou `real`).

---

## 3. Arquivos do bot

| Arquivo | O que é |
|---------|---------|
| `ws-otc-v15.mjs` | Código do bot (executável) |
| `bot-config-v15.json` | Configurações (stakes, filtros, janelas) |
| `iqoption-ws.mjs` | Cliente WebSocket da IQ Option (módulo) |
| `bot-state-v15.json` | Estado salvo entre sessões (não mexer) |
| `resultados-v15.json` | Histórico de operações (não mexer) |
| `BOT-V15-MEMORIA.md` | Memória técnica (para devs) |
| `diagnostic-results/bot-v15-tests.mjs` | Suite de testes offline |
| `diagnostic-results/bot-v15-relatorio.md` | Relatório de diagnóstico |

---

## 4. O que o bot faz, passo a passo

### 4.1 Ao ligar

1. **Conecta** no WebSocket da IQ Option.
2. **Pede o histórico** de candles 5s e 1m dos últimos ativos OTC (criptomoedas).
3. **Escolhe os 10 melhores** ativos pela taxa de acerto (WR) salva.
4. **Abre o feed** de candles 5s em tempo real.
5. **Espera 5 segundos** de warmup (candles carregando).
6. Começa a **avaliar oportunidades** a cada candle fechado.

### 4.2 A cada candle de 5 segundos

Para cada ativo, nesta ordem:

1. **Detecta a tendência**: EMA8 × EMA21 nos últimos 40 candles. Se EMA8 > EMA21 com spread ≥ 0,05% → **alta** (CALL). Se EMA8 < EMA21 com spread ≤ −0,05% → **baixa** (PUT). Entre os dois → **lateral** (não entra).
2. **Regime Filter**: se há 10+ candles seguidos na mesma direção → **bloqueia** (mercado muito tendencioso, risco de reversão).
3. **Pullback**: procura um padrão de **4 velas na mesma direção + 1 na direção oposta**. Esse é o sinal de entrada.
4. **RSI guarda-corpo**: se é CALL, RSI tem que estar ≤ 60. Se é PUT, RSI tem que estar ≥ 40. (RSI muito esticado na direção da operação = risco.)
5. **Cooldown**: se houve operação recententemente (win há < 15s, loss há < 5s) → pula.
6. **Exposição**: se já tem muitas operações abertas gastando > 50% do saldo → pula.
7. Se tudo passou → **abre a operação** (CALL ou PUT).

### 4.3 Quando uma operação fecha (win ou loss)

- **Win**: lucro credited na hora. Volta a avaliar entradas após 15s.
- **Loss**: volta a avaliar gale (veja §6).

### 4.4 Monitoramento de vendas (a cada 3s, para cada operação aberta)

1. Pega a cotação real (`sell_profit` = quanto você receberia se vendesse agora).
2. **Se está positiva**: realiza se o lucro atual ≥ 50% do lucro máximo possível (com stake 2 e payout 86%, realiza a partir de +R$0,86).
3. **Se está negativa**:
   - Só vende **no fim** da opção (entre 40s e 20s restantes).
   - Só vende se a venda devolver **≥ R$0,50** do valor investido.
   - Só vende se o preço estiver **LONGE da linha de ganho** (distância adversa ≥ 4× o candle típico de 5s).
   - Se o preço está **PERTO** da linha, o bot **ESPERA** — pode reverter.
4. Sem cotação fresca → **não vende** (fail-closed).

---

## 5. Filtros e regras de entrada

### 5.1 Tendência (EMA8 × EMA21)
- **Alta**: EMA8 > EMA21 com spread ≥ 0,05% → CALL no pullback.
- **Baixa**: EMA8 < EMA21 com spread ≤ −0,05% → PUT no repique.
- **Lateral**: entre os dois → fora.

### 5.2 Regime Filter
Bloqueia a entrada se houver **10+ candles seguidos na mesma direção**.
- Exemplo: 10 candles de alta consecutivos → bloqueia CALL (risco de reversão).
- A contagem zera depois de 3 candles mistos.

### 5.3 Pullback (sinal Fade-4)
Padrão: **4 velas na direção da tendência + 1 vela na direção contrária**.
- Funciona como um "recuo" do preço antes de retomar a direção.
- O bot entra **na direção da tendência**, não na vela contrária.

### 5.4 RSI (guarda-corpo)
- **CALL**: RSI tem que estar ≤ 60. (Se RSI > 60, o preço já subiu demais.)
- **PUT**: RSI tem que estar ≥ 40. (Se RSI < 40, o preço já caiu demais.)
- Não é um seletor de oportunidades — é uma **proteção contra entradas ruins**.

### 5.5 Cooldown por ativo
- Após **win**: 15 segundos sem nova entrada no mesmo ativo.
- Após **loss**: 5 segundos (recuperação rápida).

### 5.6 Exposição global
- Máximo de operações abertas ao mesmo tempo: **limitado pela fração do saldo** (50% do saldo em posições abertas).

---

## 6. Sistema de gale (martingale)

### 6.1 O que é
Quando uma operação fecha em **loss**, o bot pode abrir um **gale** no mesmo ativo, na mesma direção, para recuperar o prejuízo.

### 6.2 Regras da V15
- **Níveis de gale**: configurável (`martingale.levels`). Na V15 padrão está em **0** (gale desligado — stake fixo de R$2 em tudo).
- **Janela do gale**: até **120 segundos** após o loss para entrar. Se passar, o ciclo fecha.
- **O gale não exige pullback novo** — entra logo após o loss, aproveitando que o mercado acabou de andar contra.
- **Uma ordem por vez**: o gale só entra depois que a operação anterior fechou.
- **Nunca CALL e PUT no mesmo ativo** (trava dura).

### 6.3 Se níveis > 0 (martingale ativado)
- Nível 1: stake = baseStake (R$2).
- Nível 2: stake = (perda nível 1 + lucro base) / payoutRate.
- Nível 3: stake = (perda níveis 1+2 + lucro base) / payoutRate.
- Com payout 86% e base R$2: Nível 2 ≈ R$5,50 | Nível 3 ≈ R$15,13.
- **Máximo de 3 níveis por ativo** (bloqueia se passar disso).

---

## 7. Venda antecipada (Early Sell)

### 7.1 Regras

| Situação | Quando vende | Quanto |
|----------|-------------|--------|
| **Operação positiva** | Quando o lucro atual ≥ 50% do lucro máximo | Venda o que tem (lucro realizado) |
| **Operação negativa** | Só no fim (20–40s restantes), se devolver ≥ R$0,50 E o preço estiver LONGE da linha | Venda com o menor prejuízo possível |

### 7.2 O que é "LONGE da linha"
É a distância do preço atual até a linha de ganho. Se essa distância for:
- ≥ **4× o candle típico de 5s** do ativo (piso: 0,05%),
- E a venda devolver ≥ **R$0,50**,
- → o bot entende que **não há mais chance real de reverter** e vende.

Se o preço está **PERTO** da linha (ainda pode reverter), o bot **ESPERA**.

### 7.3 O que é "NUNCA vende por reversão"
Nas versões anteriores, o bot vendia qualquer operação negativa depois de 2 candles contra.
**A V15 proibiu isso.** A venda só acontece por **cotação real** (`sell_profit`), nunca por "acho que vai perder".

---

## 8. Circuit breaker e proteção

### 8.1 Circuit breaker (loss streak)
- Se o bot perder **3 vezes seguidas** (win zera a contagem), ele **pausa por 5 minutos**.
- Na tela aparece `[PAUSA 4:32]` com a contagem regressiva.
- Depois dos 5 minutos, volta a operar normalmente.

### 8.2 Trava de perda da sessão
- Se o bot perder **20% do saldo inicial**, ele para de abrir novas operações.
- Para continuar, é necessário **reiniciar o bot**.

### 8.3 Teto de exposição
- Máximo de **50% do saldo** em operações abertas ao mesmo tempo.
- Se muitas operações abertas cobrirem mais de 50% do saldo → o bot não abre mais até alguma fechar.

---

## 9. Painel (o que aparece na tela)

```
[candles | ops | W | L | vendas | WR% | P/L | abertas | ativos | PAUSA]
```

Exemplo:
```
[🕯️ 847 | 📊 43 | ✅ 31 | ❌ 12 | 💰 7 | 72.1% | +R$8,42 | 3 | 10 | ]
```

| Campo | Significado |
|-------|-------------|
| candles | Candles 5s fechados desde o boot |
| ops | Total de operações fechadas |
| W | Vitórias |
| L | Derrotas |
| vendas | Vendas antecipadas realizadas |
| WR% | Taxa de acerto (W / ops) |
| P/L | Lucro ou prejuízo acumulado |
| abertas | Operações em andamento |
| ativos | Ativos operando no momento |
| PAUSA | Contagem regressiva do circuit breaker (se ativo) |

---

## 10. Configurações principais

### 10.1 Stakes e operações

| Parâmetro | Valor padrão | Significado |
|-----------|-------------|-------------|
| `trading.baseStake` | **2** | Valor de cada operação |
| `trading.maxOpsPerAsset` | **3** | 1 entrada + até 2 gales por ativo |
| `trading.galeWindowMs` | **120.000** | Janela para entrar com gale (2 min) |
| `martingale.levels` | **0** | Níveis de martingale (0 = desligado) |
| `martingale.payoutRate` | **0.86** | Payout usado no cálculo do martingale |

### 10.2 Filtros

| Parâmetro | Valor padrão | Significado |
|-----------|-------------|-------------|
| `strategy.regimeStreakThreshold` | **10** | Bloqueia se X candles iguais seguidos |
| `strategy.rsiCallMax` | **60** | Não CALL se RSI > 60 |
| `strategy.rsiPutMin` | **40** | Não PUT se RSI < 40 |
| `strategy.trendMinEmaSpreadPct` | **0.05** | Spread mínimo EMA8×EMA21 para tendência |
| `strategy.trendLookback` | **40** | Candles para calcular EMA8 e EMA21 |
| `cooldown.afterWinMs` | **15.000** | Cooldown após win (15s) |
| `cooldown.afterLossMs` | **5.000** | Cooldown após loss (5s) |

### 10.3 Venda antecipada

| Parâmetro | Valor padrão | Significado |
|-----------|-------------|-------------|
| `sell.takeProfitPctOfWin` | **50** | Realiza quando lucro ≥ X% do lucro máximo |
| `sell.takeProfitMin` | **0.80** | Lucro mínimo realizável (R$) |
| `sell.endgameAfterMs` | **40.000** | Início da janela de venda de loss (40s antes do fim) |
| `sell.endgameBeforeMs` | **20.000** | Fim da janela (20s antes do fim) |
| `sell.minRecover` | **0.50** | Vende se a venda devolver ≥ R$0,50 |
| `sell.endgameDistanceFactor` | **4** | Múltiplo do candle típico para "LONGE da linha" |

### 10.4 Proteção

| Parâmetro | Valor padrão | Significado |
|-----------|-------------|-------------|
| `risk.maxExposurePct` | **50** | % máxima do saldo em operações abertas |
| `risk.stopAfterConsecutiveLosses` | **3** | Losses seguidos para circuit breaker |
| `risk.pauseAfterLossStreakMs` | **300.000** | Pausa do circuit breaker (5 min) |
| `risk.maxSessionLossPct` | **20** | % de perda do saldo para travar o bot |

### 10.5 Universo de ativos

| Parâmetro | Valor padrão | Significado |
|-----------|-------------|-------------|
| `universe.minActive` | **10** | Mínimo de ativos operando |
| `universe.maxActive` | **16** | Máximo de ativos operando |
| `universe.replaceStaleMs` | **180.000** | Substitui ativo sem candle 5s há 3 min |

---

## 11. Como atualizar a configuração

Editando `bot-config-v15.json`:

```json
{
  "trading": {
    "baseStake": 2,
    "expirationMinutes": 2,
    "maxOpsPerAsset": 3,
    "galeWindowMs": 120000
  },
  "martingale": {
    "levels": 0,
    "payoutRate": 0.86
  },
  "risk": {
    "maxExposurePct": 50,
    "stopAfterConsecutiveLosses": 3,
    "pauseAfterLossStreakMs": 300000
  },
  "cooldown": {
    "afterWinMs": 15000,
    "afterLossMs": 5000
  },
  "sell": {
    "quotePollMs": 3000,
    "takeProfitPctOfWin": 50,
    "takeProfitMin": 0.80,
    "endgameAfterMs": 40000,
    "endgameBeforeMs": 20000,
    "minRecover": 0.50,
    "endgameDistanceFactor": 4
  },
  "universe": {
    "minActive": 10,
    "maxActive": 16
  },
  "strategy": {
    "regimeStreakThreshold": 10,
    "rsiCallMax": 60,
    "rsiPutMin": 40,
    "trendMinEmaSpreadPct": 0.05,
    "trendLookback": 40
  }
}
```

**Sempre reiniciar o bot depois de alterar o config.**

---

## 12. Testes offline

```bash
cd "D:/Tracecom project"

# Testes offline (nenhuma ordem, simula o comportamento)
node diagnostic-results/bot-v15-tests.mjs

# Testes com candles reais da IQ (login + histórico, zero ordens)
REAL=1 node diagnostic-results/bot-v15-tests.mjs
```

Resultado esperado: **51/51 testes verdes**.

---

## 13. Debugging

```bash
# Log detalhado do socket WebSocket
IQ_WS_VERBOSE=1 node ws-otc-v15.mjs demo

# Dump cru da IQ em volta de cada venda
IQ_SELL_DEBUG=1 node ws-otc-v15.mjs demo
```

- `IQ_WS_VERBOSE=1`: mostra tudo que entra e sai do socket (muito verboso).
- `IQ_SELL_DEBUG=1`: mostra o dump cru da IQ nas janelas de venda — serve para investigar se a IQ está respondendo corretamente ao `sell-options`.

---

## 14. Problemas já resolvidos (não repetir)

| Bug | O que acontecia | O que foi feito |
|-----|----------------|----------------|
| **Venda por reversão** | Vendia qualquer op negativa depois de 2 candles contra | Proibida na V15. Venda só por cotação real. |
| **Empilhamento de ordens** | Abria 3 ordens no mesmo ativo no mesmo segundo | Trava dura: 1 ordem por vez, por ativo. |
| **Valor de ordem errado** | O valor do `activeOps` era sobrescrito (R$300+ apareceram) | Cada operação guarda seu próprio stake no `resultsList`. |
| **P/L com NaN** | `Number(raw.win)` falhava com resposta mal formatada da IQ | `Number(raw.win) \|\| 0`. |
| **Bot zumbi** | WebSocket caía mas o bot não saía | Cliente agora avisa o bot quando cai; bot sempre imprime resumo e sai. |
| **sell_profit mal interpretado** | Calculava `recebido - stake` em vez de usar o líquido | Usa `sell_profit` direto (já é líquido). |
| **Warmup insuficiente** | Entrava antes de ter candles carregados | 5 segundos de warmup no boot. |

---

## Atalhos，快速参考 (Quick Reference)

```
node ws-otc-v15.mjs demo          → Demo
node ws-otc-v15.mjs real          → Real
node ws-otc-v15.mjs demo --ativos  → Listar ativos
node ws-otc-v15.mjs               → Pergunta (1=Real, 2=Demo)

# Filtros
RSI CALL ≤ 60 | RSI PUT ≥ 40
Tendência: EMA8 × EMA21 (spread ≥ 0,05%)
Regime: 10+ candles iguais = bloqueia
Pullback: 4 velas na tendência + 1 contra

# Venda
Positiva: ≥ 50% do lucro máximo
Negativa: só no fim (20–40s restantes) + devolver ≥ R$0,50 + preço LONGE da linha
Nunca por reversão

# Proteção
Circuit breaker: 3 losses → 5 min pausa
Exposição: ≤ 50% do saldo em aberto
Sessão: -20% do saldo → bot para

# Martingale
levels: 0 = desligado (stake fixo R$2)
levels: 3 = R$2 → R$5,50 → R$15,13
Máximo: 3 níveis por ativo
```

---

*Este documento é parte do projeto Tracecom. Última atualização: 2026-10-01.*
