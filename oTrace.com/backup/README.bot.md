# Bot OTC — Manual do Operador

> Arquivo: `README.bot.md` | Versão: 16 | Data: 2026-10-01
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
7. [Venda antecipada](#7-venda-antecipada)
8. [Proteções](#8-proteções)
9. [Painel e teclas](#9-painel-e-teclas)
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

# Rodar na REAL (dinheiro real — confirme antes)
node ws-otc-v15.mjs real

# Perguntar qual conta (1 = REAL, 2 = DEMO)
node ws-otc-v15.mjs

# Listar os ativos turbo disponíveis (sem operar)
node ws-otc-v15.mjs demo --ativos
```

**Reiniciar sempre depois de qualquer alteração no código ou configuração.**

No boot aparece `[🧬] CÓDIGO V16 sha256:xxxxxxxx` — se mostrar outro hash, é código velho.

---

## 2. Contas: Demo e Real

O bot identifica as contas pela API da IQ Option:

| Tipo | ID da Conta | Nome na IQ | Moeda |
|------|------------|-----------|-------|
| **4** | `1250741747` | PRACTICE | USD |
| **1** | `1250741746` | REAL | BRL |

- **PRACTICE (tipo 4)**: conta demo. Saldo de US$60.
- **REAL (tipo 1)**: dinheiro de verdade. Em 2026-10-01 o saldo disponível era R$0,00 (R$1,31 de bônus).

O bot escolhe a conta pelo argumento (`demo` ou `real`). Sem argumento e sem credencial salva, pergunta.

---

## 3. Arquivos do bot

| Arquivo | O que é |
|---------|---------|
| `ws-otc-v15.mjs` | Código do bot (executável) |
| `bot-config-v15.json` | Configurações (stakes, filtros, janelas) |
| `iqoption-ws.mjs` | Cliente WebSocket da IQ Option (módulo) |
| `bot-state-v15.json` | Estado salvo entre sessões (não mexer) |
| `resultados-v15.json` | Histórico de operações (não mexer) |
| `BOT-V15-MEMORIA.md` | Memória técnica (para devs/agentes) |
| `diagnostic-results/bot-v15-tests.mjs` | Suíte de testes offline (56 testes) |
| `diagnostic-results/bot-v15-relatorio.md` | Relatório de diagnóstico |

---

## 4. O que o bot faz, passo a passo

### 4.1 Ao ligar

1. Faz **login** na IQ e **conecta** no WebSocket.
2. Pede o **histórico** de candles 5s e 1m de cada ativo OTC do universo — **antes de assinar o feed ao vivo** (chunks de 10; ~8s para 92 ativos).
3. Monta o **universo**: no mínimo **170 ativos** e no máximo **200** (top 61 da whitelist + reserva + auto-fill com qualquer OTC turbo).
4. **Assina o feed** de candles 5s (e 1m) em tempo real.
5. **Espera 5 segundos** de warmup.
6. Começa a avaliar oportunidades a cada **candle 5s fechado**.

O universo é revisado a cada **30s**: ativo fechado/suspenso/sem candle por 3 min é substituído (ativo com ordem aberta só sai depois de fechar).

### 4.2 A cada candle de 5 segundos

Para cada ativo, nesta ordem (tudo precisa passar):

1. **Nunca CALL e PUT juntos** no mesmo ativo (trava dura) e no máximo **2 posições** no mesmo sentido. A 2ª compra (pirâmide) só sai na **chance quase perfeita de não reverter**: **ADX ≥ 25** + **RSI no extremo A FAVOR** (CALL ≤ 35 / PUT ≥ 65) + **sem reversão se formando** contra a posição (preço adverso à 1ª entrada + velas contra + RSI do lado oposto). Fora disso: **1 compra só**. A 3ª ordem do ciclo é o martingale.
2. **Tendência**: EMA8 × EMA21 nos últimos 50 candles. Spread ≥ **0,06%** → alta (CALL); ≤ −0,06% → baixa (PUT); entre os dois → lateral (não entra).
3. **ADX ≥ 20**: tendência fraca (`adx < 20`) **ou ADX = 0** (histórico insuficiente) → bloqueia.
4. **Ciclo do gale fechado** (já usou 1 entrada + 2 gales) → bloqueia.
5. **Pullback (Fade-4)**: 4 candles caindo + 1 subindo (para CALL) ou 4 subindo + 1 caindo (para PUT). É o sinal de entrada.
6. **Regime**: se a janela tiver 12+ candles seguidos na mesma direção → bloqueia. *(Observação técnica registrada na memória: hoje o bloqueio de regime vence mesmo com pullback formado — pendência de decisão, ver `BOT-V15-MEMORIA.md` §10.)*
7. **RSI (guarda-corpo V16)**: CALL exige RSI ≤ **55**; PUT exige RSI ≥ **45**.
8. Se tudo passou → **abre a operação** (CALL ou PUT).

### 4.3 Quando uma operação fecha

- **Win**: lucro creditado. O ciclo zera e o ativo pode reentrar na próxima candle (sem cooldown pós-win).
- **Loss** (inclui a venda por reversão com líquido negativo): o bot volta no **mesmo ativo** em até **120s** com um **gale** (mesma direção da tendência do momento). Passou dos 120s → ciclo fecha. Entre ciclos, o ativo espera **5s** após loss.

### 4.4 Venda antecipada (a cada 3s, para cada operação aberta)

Veja a seção 7.

---

## 5. Filtros e regras de entrada

### 5.1 Tendência (EMA8 × EMA21)
- **Alta**: EMA8 > EMA21 com spread ≥ 0,06% → CALL no pullback.
- **Baixa**: EMA8 < EMA21 com spread ≤ −0,06% → PUT no repique.
- **Lateral**: entre os dois → fora.

### 5.2 ADX (força mínima)
- **ADX ≥ 20** é obrigatório — não basta ter direção, a tendência precisa ter força.
- **ADX = 0** (ativo sem histórico 1m suficiente) também bloqueia.

### 5.3 Pullback (sinal Fade-4)
Padrão: **4 velas na direção contrária + 1 vela na direção da tendência** (para CALL: 4 caindo + 1 subindo; para PUT: o espelho). O bot entra na direção da tendência, no recuo.

### 5.4 Regime
Bloqueia a entrada quando a janela recente (20 candles) tem **12+ movimentos seguidos na mesma direção** — mercado muito esticado.

### 5.5 RSI (guarda-corpo)
- **CALL**: RSI tem que estar ≤ 55. (Se RSI > 55, o preço já subiu demais.)
- **PUT**: RSI tem que estar ≥ 45. (Se RSI < 45, o preço já caiu demais.)
- Não é seletor de oportunidade — é proteção contra entrada esticada.

### 5.6 Cooldown (não configurável)
- Após **win**: 0 ms — reavalia na próxima candle.
- Após **loss**: 5 s.
- Vale só entre ciclos, quando o ativo está **sem operação aberta**.

### 5.7 Exposição
- Máximo de **50% do saldo** somando todas as operações abertas (fração do saldo, nunca número fixo).
- Teto por ordem: R$20 (`risk.maxStake`).

---

## 6. Sistema de gale (martingale)

### 6.1 O que é
Quando uma operação fecha em **loss**, o bot volta no **mesmo ativo**, na direção da tendência do momento, para recuperar.

### 6.2 Regras da V16 (regra do dono, 2026-10-02)
- **Ciclo de 3 ordens por ativo**: 1 entrada + no máximo **1 pirâmide** + **1 martingale**.
- **Stake fixo na base (2)** em toda ordem. A **única exceção é o martingale**, que vale
  **2,75 × o que está sendo recuperado** (soma das posições vendidas por reversão):
  1 posição de 2,00 → **US$5,50**; 2 posições de 2,00 → **US$11,00**. Se a base for 4,00, o
  martingale escala junto (5,5 × base).
- **Um martingale por sequência**: se ele perder, a próxima ordem do ativo **volta ao stake
  base**. O martingale **não arma outro martingale** (nunca compõe — foi a escada composta
  2 × 2,75^n que zerou a conta no V13 antigo).
- **Quando entra**: depois da **venda por reversão** confirmada contra a posição, no **sentido
  NOVO**, dentro da janela do gale (120s). Se ainda houver posição aberta no lado antigo, espera
  (nunca CALL e PUT juntos).
- **Recuperação (payout 82%)**: 5,50 no win devolve 4,51 sobre 2,00 perdidos → **+2,51**;
  11,00 devolve 9,02 sobre 4,00 → **+5,02**.
- **Pirâmide** (2ª posição no mesmo sentido) só sai na **chance quase perfeita de não reverter**:
  **ADX ≥ 25** + **RSI no extremo A FAVOR** (CALL ≤ 35 / PUT ≥ 65) + reversão não se formando.
  Fora disso o bot compra **uma vez só**.

### 6.3 Early Gale Monitor (existe no código, mas está INERTE)
Há um monitor de 1s que em teoria abriria o gale **antes** da operação original fechar. Na prática ele está **inativo por defeito conhecido** (documentado em `BOT-V15-MEMORIA.md` §9): busca um campo que a operação não tem e, mesmo corrigido, o fluxo cairia em pyramidagem. **Decisão registrada: deixar como está.** Não espere gales antecipados.

---

## 7. Venda antecipada

A venda antecipada é **por reversão confirmada** e sai **a mercado**: a IQ manda `sell_profit` (a **devolução** da recompra) só no **abrir e no fechar** da posição — não existe cotação de meio de vida (medido em 2026-10-02: push só na abertura e `get-options` estático). Por isso o valor real da recompra é lido **no fechamento**.

| Situação | Quando vende | Quanto |
|----------|-------------|--------|
| **Reversão CONFIRMADA contra a posição** | A qualquer momento da opção (fora dos últimos **20s**, que a IQ não aceita) | O que o broker devolver na recompra (lido no fechamento) |
| **Sem reversão** | Nunca — deixa a opção vencer | — |

- **Vender cedo é o que salva**: medido ao vivo, a recompra vale ~R$0,75–1,00 nos primeiros minutos (perda de ~R$1,00–1,25 em vez de R$2,00) e desaba para ~R$0,15 no último minuto. O bot reavalia **a cada 1 segundo** por posição.
- **GALE DE REVERSÃO** (`sell.reversalGale`): depois de vender por reversão, o bot **entra no sentido novo** (o lado da reversão) sem exigir pullback novo — o flip é o gatilho — dentro da janela do gale (120s). Se o lado antigo ainda tiver posições, ele espera elas fecharem.
- O log mostra a confirmação:
  `[✂️ REVERSÃO] ... | venda a mercado (o valor sai no fechamento) | reversão contra CALL: tendência -0.12% | RSI 31 | 3/3 velas contra | 0.21% adverso (>= 0,08%) | restam 187s`.

### O que é "reversão confirmada"
Todos os fatores precisam concordar (config `sell.reversal`):
1. **Tendência virou contra** a posição (EMA8×21 no lado oposto).
2. **RSI do lado oposto** — CALL: RSI ≤ 45; PUT: RSI ≥ 55.
3. **Velas contra** — pelo menos 2 das últimas 3 velas de 5s fecham contra a posição.
4. **Preço adverso** à entrada ≥ 1× o candle típico de 5s — é isso que garante que **não vende operação ganhando**.

---

## 8. Proteções

- **Circuit breaker: REMOVIDO na V16.** O bot não pausa por losses consecutivos.
- **Trava de perda da sessão**: perdeu **20% do saldo do boot** → para de abrir novas operações (só reiniciando). Aparece `[🛑 TRAVA DE PERDA]` no log.
- **Teto de exposição**: 50% do saldo em operações abertas.
- **Máximo por ordem**: R$20.
- **Meta de lucro**: ao acumular **R$1.000** de lucro, o bot encerra sozinho com relatório final (`stop.profitTarget`).
- **Queda de conexão**: o cliente avisa e o bot **imprime o resumo final e sai** — nada de processo zumbi. Não há reconexão automática; é só reiniciar.

---

## 9. Painel e teclas

```
[🕯️ candles | 📊 ops | ✅ W | ❌ L | 💰 vendas | WR% | P/L | abertas | ativos | PAUSA]
```

| Campo | Significado |
|-------|-------------|
| candles | Candles 5s fechados desde o boot |
| ops | Operações fechadas |
| W / L | Vitórias / derrotas |
| vendas | Vendas antecipadas realizadas |
| WR% | Taxa de acerto (W / ops) |
| P/L | Lucro/prejuízo acumulado |
| abertas | Operações em andamento |
| ativos | Ativos operando no momento |

**Teclas:** `K` = kill switch (resumo final + sair) · `T` = mostrar/ocultar painel · `Ctrl+C` = idem K.

Enquanto nenhuma operação fechou, o bot imprime a cada 60s um diagnóstico `[🔍] diag 60s` (universo, candles, ADX de amostra) no mesmo canal do log.

---

## 10. Configurações principais

### 10.1 Stakes e operações

| Parâmetro | Valor padrão | Significado |
|-----------|-------------|-------------|
| `trading.baseStake` | **2** | Valor de cada operação (fixo) |
| `trading.expirationMinutes` | **2** | Expiração (2 min — decisão do dono 2026-10-02) |
| `trading.maxOpsPerAsset` | **3** | Ciclo: 1 entrada (+1 pirâmide) + 1 martingale |
| `trading.galeWindowMs` | **120.000** | Janela para o martingale entrar (2 min) |
| `martingale.levels` | **0** | 0 = stake fixo fora do martingale |
| `martingale.martingaleMultiplier` | **2.75** | 2,75 × a exposição a recuperar |
| `martingale.payoutRate` | **0.86** | Payout usado em cálculos |
| `strategy.pyramidMax` | **1** | No máximo 1 pirâmide (2 posições simultâneas) |
| `strategy.pyramidAdxMin` | **25** | ADX mínimo para a 2ª compra |
| `strategy.pyramidRsiCallMax` / `pyramidRsiPutMin` | **35 / 65** | RSI no extremo A FAVOR para a 2ª compra |

### 10.2 Filtros

| Parâmetro | Valor padrão | Significado |
|-----------|-------------|-------------|
| `strategy.candleSizeSeconds` | **5** | Tamanho do candle operacional |
| `strategy.lookbackRegime` | **20** | Janela do regime |
| `strategy.regimeStreakThreshold` | **12** | Bloqueia com X candles iguais seguidos |
| `strategy.trendLookback` | **50** | Candles para EMA8 × EMA21 |
| `strategy.trendMinEmaSpreadPct` | **0.06** | Spread mínimo da tendência |
| `strategy.adxMin` | **20** | ADX mínimo (0 também bloqueia) |
| `strategy.rsiPeriod` | **14** | Período do RSI |
| `strategy.rsiCallMax` | **55** | Não CALL se RSI > 55 |
| `strategy.rsiPutMin` | **45** | Não PUT se RSI < 45 |
| `strategy.warmupMs` | **5000** | Warmup após o boot |
| `strategy.min1mCandles` | **1** | Mínimo de candles 1m para ADX |
| `strategy.staleCandleMs` | **30000** | Candle velho = ativo não opera |

### 10.3 Venda antecipada

| Parâmetro | Valor padrão | Significado |
|-----------|-------------|-------------|
| `sell.closeBeforeMs` | **20000** | Últimos 20s: a IQ não aceita venda (nem tenta) |
| `sell.reversalGale` | **true** | Depois de vender por reversão, entra no sentido novo sem exigir pullback (janela do gale) |
| `sell.volLookbackCandles` | **12** | Candles para medir o candle típico de 5s |
| `sell.reversal.candles` / `.candlesAgainstMin` | **3** / **2** | Velas de 5s avaliadas e quantas precisam fechar contra a posição |
| `sell.reversal.rsiCallMax` / `.rsiPutMin` | **45** / **55** | RSI do lado oposto (confirmação de reversão) |
| `sell.reversal.minAdverseFactor` / `.minAdversePct` | **1** / **0.02** | Movimento adverso mínimo (× candle típico, piso %) |
| `sell.retryAfterMs` | **8000** | Intervalo entre tentativas de venda |
| `sell.maxAttempts` | **4** | Máximo de tentativas de venda |
| `sell.earlyGale` | **enabled: true** | Config do monitor — **o monitor está inerte por decisão registrada** |

### 10.4 Risco

| Parâmetro | Valor padrão | Significado |
|-----------|-------------|-------------|
| `risk.maxStake` | **20** | Teto por ordem |
| `risk.maxExposurePct` | **50** | % máxima do saldo em operações abertas |
| `risk.maxSessionLossPct` | **20** | % de perda da sessão para travar |
| `stop.profitTarget` | **1000** | Lucro que encerra o bot sozinho |

### 10.5 Universo

| Parâmetro | Valor padrão | Significado |
|-----------|-------------|-------------|
| `universe.minActive` | **170** | Mínimo de ativos operando |
| `universe.maxActive` | **200** | Máximo de ativos operando |
| `universe.replaceStaleMs` | **180.000** | Substitui ativo sem candle 5s há 3 min |
| `universe.checkEveryMs` | **30.000** | Revisão do universo (30s) |

### 10.6 Campos que NÃO existem mais (removidos na auditoria de 2026-10-01)
- `cooldown.*` — o cooldown real é hardcoded (0 ms pós-win / 5.000 ms pós-loss) e não é configurável.
- `martingale.flipAfterLosses` — flip desativado na V16.
- `stop.stopAfterLosses` — nunca foi lido pelo código.

---

## 11. Como atualizar a configuração

Editando `bot-config-v15.json` (exemplo enxuto):

```json
{
  "trading": { "baseStake": 2, "expirationMinutes": 2, "maxOpsPerAsset": 3, "galeWindowMs": 120000 },
  "martingale": { "levels": 0, "payoutRate": 0.86, "martingaleMultiplier": 2.75 },
  "risk": { "maxStake": 20, "maxExposurePct": 50, "maxSessionLossPct": 20 },
  "sell": { "quoteFreshMs": 3000, "closeBeforeMs": 20000, "minRecover": 0.50, "reversal": { "candles": 3, "candlesAgainstMin": 2, "rsiCallMax": 45, "rsiPutMin": 55 } },
  "universe": { "minActive": 170, "maxActive": 200, "checkEveryMs": 30000 },
  "strategy": { "candleSizeSeconds": 5, "adxMin": 20, "rsiCallMax": 55, "rsiPutMin": 45 },
  "stop": { "profitTarget": 1000 }
}
```

**Sempre reiniciar o bot depois de alterar o config.** Depois de qualquer mudança aprovada, espelhar os arquivos vivos no cofre (`oTrace.com/backup/` — ver §4 da memória).

---

## 12. Testes offline

```bash
cd "D:/Tracecom project"

# Testes offline (nenhuma ordem, funções puras + estrutura do código)
node diagnostic-results/bot-v15-tests.mjs

# Replay com candles reais da IQ (login + histórico, zero ordens)
REAL=1 node diagnostic-results/bot-v15-tests.mjs

# Diagnóstico read-only da hidratação do boot (login + candles, zero ordens)
node diagnostic-results/bot-v15-hidratacao-diag.mjs
```

Resultado esperado: **70/70 testes verdes**.

---

## 13. Debugging

```bash
# Log detalhado do socket WebSocket
IQ_WS_VERBOSE=1 node ws-otc-v15.mjs demo

# Dump cru da IQ em volta de cada venda
IQ_SELL_DEBUG=1 node ws-otc-v15.mjs demo
```

- `IQ_WS_VERBOSE=1`: mostra tudo que entra e sai do socket (muito verboso).
- `IQ_SELL_DEBUG=1`: imprime os primeiros eventos crus `position-changed` (prova do `sell_profit`) e o dump cru da IQ nos 10s seguintes a cada pedido de venda (`sell-options`).

---

## 14. Problemas já resolvidos (não repetir)

| Bug | O que acontecia | O que foi feito |
|-----|----------------|----------------|
| **Venda por reversão** | Vendia qualquer op negativa depois de 2 candles contra (sem confirmação de nada) | Proibida. Hoje vende SÓ com reversão **confirmada** (tendência + RSI + velas + distância) e **nunca ganhando**. |
| **Empilhamento de ordens** | Abria 3 ordens no mesmo ativo no mesmo segundo | Trava dura: 1 ordem por vez, por ativo. |
| **Valor de ordem errado** | O valor do `activeOps` era sobrescrito (R$300+ apareceram) | Cada operação guarda seu próprio stake no `resultsList`. |
| **P/L com NaN** | `Number(raw.win)` falhava com resposta mal formatada | `Number(raw.win) \|\| 0`. |
| **Bot zumbi** | WebSocket caía mas o bot ficava girando com feed morto, sem resumo | Cliente avisa na queda (só quando a conexão estava READY) e o bot **imprime o resumo final e sai** (`shutdown('WS')`). |
| **sell_profit mal interpretado** | Tratava a DEVOLUÇÃO da recompra como lucro (devolveu 2,00 → gravou +2,00; real = 0) | Líquido = `devolução − stake` (`saleNet`), confirmado no extrato `closed_options` da IQ. |
| **Warmup insuficiente** | Entrava antes de ter candles carregados | 5 segundos de warmup no boot. |
| **Histórico do boot engolido pelo feed** | Com o feed assinado antes, o candle em formação anulava a hidratação (`9/92` prontos) e o bot ficava sem dados/ADX | Hidratação agora roda **antes** de assinar o feed (`92/92` em ~8s, medido) |
| **`close-position` ignorada pela IQ** | O pedido de venda sumia em silêncio | A mensagem correta é `sell-options` (com teste estático garantindo). |
| **Sem cotação reconhecida** | Venda automática podia agir sem preço | Sem `sell_profit` fresco → **não vende** (fail-closed). |
| **ADX sempre 0 (0 ops)** | `high`/`low` não eram mapeados do feed (barra só com `close`) → DMI/ADX = 0 → o portão `adxFraco` bloqueava TODA entrada | `highOf`/`lowOf` do payload (`max`/`min`) + `ClosedCandles` com high/low; amostra `adxSample=18.8` no boot |
| **Venda por cotação nunca disparava** | `get-options` v2.0 é silencioso na IQ; a v1.0 responde sem `sell_profit` (`profit` sempre 0) | Cotação agora vem do push `portfolio.position-changed` v3.0 (`sell_profit` real); poll removido |
| **Log da venda quebrava** | `requestSell` lia `decision.recovery` fora do ramo de corte → `HANDLER_ERROR ... reading 'toFixed'` em cada venda | Ramo do corte corrigido + rótulo pelo kind real; regressão na suíte |
| **Campos de config inertes** | `cooldown`, `flipAfterLosses` e `stopAfterLosses` pareciam configuráveis mas o código ignorava | Removidos do config na auditoria de 2026-10-01. |

---

## Atalhos — Quick Reference

```
node ws-otc-v15.mjs demo           → Demo
node ws-otc-v15.mjs real           → Real
node ws-otc-v15.mjs demo --ativos  → Listar ativos
node ws-otc-v15.mjs                → Pergunta (1=Real, 2=Demo)

# Filtros
RSI CALL ≤ 55 | RSI PUT ≥ 45
ADX ≥ 20 (0 também bloqueia)
Tendência: EMA8 × EMA21 (spread ≥ 0,06%) na janela de 50 candles
Regime: 12+ candles iguais na janela de 20 = bloqueia
Pullback: 4 velas contra a tendência + 1 a favor

# Venda
Cotação em tempo real (push do broker: sell_profit = devolução da recompra)
Nunca vende ganhando (devolução ≥ stake = deixa vencer)
Vende SÓ com reversão confirmada: tendência virou + RSI contrário (CALL ≤45 / PUT ≥55) + ≥2/3 velas contra + adverso ≥ 1× candle típico
Exige devolução ≥ R$0,50 e > 20s restantes | Sem cotação fresca = não vende

# Proteção
Sem circuit breaker (removido na V16)
Exposição: ≤ 50% do saldo em aberto | Teto por ordem: R$20
Sessão: −20% do saldo do boot → bot para | Meta: +R$1.000 → encerra sozinho

# Gale
Stake fixo R$2 (levels: 0) | Ciclo: 1 entrada + até 2 gales, uma ordem por vez
Janela: 120s após o loss | Nunca CALL e PUT no mesmo ativo
```

---

*Este documento é parte do projeto Tracecom. Última atualização: 2026-10-01.*
