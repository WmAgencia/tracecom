# oTrace.com - Sistema de Backup e Documentação do Bot OTC

> **Data do Backup:** 2026-09-30  
> **Versão do Bot:** v13  
> **Status:** ATIVO E FUNCIONANDO

---

## 📁 Estrutura do Backup

```
oTrace.com/
├── backup/                    # Cópias de segurança dos arquivos críticos
│   ├── bot-config-v13.json   # Configurações do bot (VERSÃO REAL)
│   ├── bot-state-v13.json    # Estado atual do aprendizado
│   ├── learning-state.json   # Estado de aprendizado
│   ├── ws-otc-v13.mjs        # Código fonte do bot principal
│   ├── iqoption-ws.mjs      # Cliente WebSocket IQ Option
│   └── package.json          # Dependências do projeto
│
├── docs/                     # Documentação
│   ├── VERIFICACAO-SISTEMA.md # Relatório de verificação
│   └── README-SISTEMA.md     # Este arquivo (atualizado)
│
└── README.md                 # Documentação principal
```

---

## ⚙️ CONFIGURAÇÃO REAL DO BOT v13

### Arquivo: `bot-config-v13.json`

```json
{
  "_version": "13",
  "_desc": "Bot v13 - Auto-flip + Martingale + Early Sell corrigido + RSI estrito",

  "login": {
    "email": "Anaalaura2008@gmail.com",
    "password": "Eqvpanp.32"
  },

  "trading": {
    "baseStake": 2,
    "expirationMinutes": 2,
    "reportIntervalMs": 300000,
    "maxConcurrentOps": 5
  },

  "strategy": {
    "candleSizeSeconds": 5,
    "lookbackRegime": 20,
    "regimeStreakThreshold": 10,
    "rsiPeriod": 14,
    "rsiCallThreshold": 45,
    "rsiPutThreshold": 55,
    "volatilityMin": 0.0002,
    "icLowerGate": 0.50,
    "warmupMs": 120000,
    "min1mCandles": 2,
    "staleCandleMs": 30000
  },

  "learning": {
    "minSampleSize": 10,
    "killWR": 0.45,
    "weightHistorical": 0.3,
    "weightObserved": 0.7,
    "recalibrateAfter": 15,
    "autoFlipAfter": 2,
    "martingaleAfter": 2,
    "martingaleMultiplier": 2.75
  },

  "earlySell": {
    "enabled": true,
    "checkIntervalMs": 10000,
    "minProfitToSell": 0.15,
    "profitPercentToSell": 0.50,
    "minSecondsBeforeSell": 20,
    "maxSecondsBeforeSell": 100
  },

  "whitelist": {
    "RENDERUSD": { "name": "front.RENDERUSD-OTC", "direction": "CALL", "wr": 100.0 },
    "WIFUSD":   { "name": "front.WIFUSD-OTC",   "direction": "PUT",  "wr": 100.0 },
    "DOTUSD":   { "name": "front.DOTUSD-OTC",   "direction": "PUT",  "wr": 100.0 },
    "SUIUSD":   { "name": "front.SUIUSD-OTC",   "direction": "PUT",  "wr": 100.0 },
    "XPTUSD":   { "name": "front.XPTUSD-OTC",   "direction": "PUT",  "wr": 100.0 },
    "ORDIUSD":  { "name": "front.ORDIUSD-OTC",  "direction": "CALL", "wr": 75.0 },
    "HYPE":     { "name": "front.HYPE-OTC",      "direction": "CALL", "wr": 75.0 },
    "TRON":     { "name": "front.TRON-OTC",      "direction": "CALL", "wr": 66.7 },
    "SHIBUSD":  { "name": "front.SHIBUSD-OTC",  "direction": "PUT",  "wr": 66.7 },
    "RAYDIUMUSD": { "name": "front.RAYDIUMUSD-OTC", "direction": "CALL", "wr": 66.7 }
  },

  "paths": {
    "state": "D:/Tracecom project/bot-state-v13.json",
    "results": "D:/Tracecom project/resultados-v13.json",
    "report": "D:/Tracecom project/relatorio-v13.json"
  }
}
```

---

## 📊 Descrição Detalhada dos Campos

### 💰 Trading (Negociação)

| Campo | Valor | Descrição |
|-------|-------|-----------|
| `baseStake` | 2 | Valor base da aposta em dólares |
| `expirationMinutes` | 2 | Tempo de expiração (2 minutos para OTC) |
| `reportIntervalMs` | 300000 | Intervalo de relatório (5 min) |
| `maxConcurrentOps` | 5 | Máximo de operações simultâneas |

### 📊 Strategy (Estratégia)

| Campo | Valor | Descrição |
|-------|-------|-----------|
| `candleSizeSeconds` | 5 | Tamanho do candle (5 segundos) |
| `lookbackRegime` | 20 | Candles para detectar regime |
| `regimeStreakThreshold` | 10 | Se 10+ candles iguais = tendência |
| `rsiPeriod` | 14 | Período do RSI |
| `rsiCallThreshold` | 45 | RSI <= 45 permite CALL |
| `rsiPutThreshold` | 55 | RSI >= 55 permite PUT |
| `volatilityMin` | 0.0002 | Volatilidade mínima (filtro) |
| `icLowerGate` | 0.50 | IC mínimo = 50% |
| `warmupMs` | 120000 | Aquecimento (2 minutos) |
| `min1mCandles` | 2 | Mínimo candles 1min |
| `staleCandleMs` | 30000 | Candle stale após 30s |

### 🧠 Learning (Aprendizado)

| Campo | Valor | Descrição |
|-------|-------|-----------|
| `minSampleSize` | 10 | Mínimo ops antes de avaliar |
| `killWR` | 0.45 | WR < 45% = mata ativo |
| `weightHistorical` | 0.3 | Peso histórico (30%) |
| `weightObserved` | 0.7 | Peso observado (70%) |
| `recalibrateAfter` | 15 | Recalibra após 15 ops |
| `autoFlipAfter` | 2 | Auto-flip após 2 losses |
| `martingaleAfter` | 2 | Martingale após 2 losses |
| `martingaleMultiplier` | 2.75 | Multiplicador martingale |

### 🎯 Early Sell (Venda Antecipada)

| Campo | Valor | Descrição |
|-------|-------|-----------|
| `enabled` | true | Venda antecipada ATIVA |
| `checkIntervalMs` | 10000 | Verifica a cada 10s |
| `minProfitToSell` | 0.15 | Mínimo 15% lucro para vender |
| `profitPercentToSell` | 0.50 | Vende se lucrar 50% do máximo |
| `minSecondsBeforeSell` | 20 | Mínimo 20s antes de vender |
| `maxSecondsBeforeSell` | 100 | Máximo 100s antes de vender |

---

## 🎰 Sistema de Martingale REAL

### Como Funciona

```
BASE STAKE = $2

Após 1 LOSS:
  └── Stake = $2 (mantém)

Após 2 LOSSES:
  └── Stake = $2 × 2.75 = $5.50 (MARTINGALE ATIVA!)
  └── Direção pode ser FLIPADA (autoFlip)

Após 3+ LOSSES:
  └── Stake = $5.50 (mantém martingale)
  └── OU desabilita ativo se WR < 45%
```

### Cálculo do Martingale

```javascript
const martingaleMultiplier = 2.75;

if (consecutiveLosses >= martingaleAfter) {
  stake = baseStake * Math.pow(martingaleMultiplier, consecutiveLosses - martingaleAfter + 1);
}
// Exemplo: 2 losses = 2 * 2.75^1 = $5.50
// Exemplo: 3 losses = 2 * 2.75^2 = $15.13
```

### ⚠️ ATENÇÃO: Martingale ATIVO!

O martingale REAL está ATIVO nesta versão v13! Diferente de um circuit breaker simples, ele:
1. Dobra/redimensiona a stake após losses
2. Usa multiplicador de 2.75x
3. Pode fazer auto-flip da direção após 2 losses

---

## ✅ Whitelist de Ativos OTC

| Ativo | Nome na IQ | Direção | WR (%) |
|-------|------------|---------|--------|
| RENDERUSD | RENDERUSD-OTC | CALL | 100% |
| WIFUSD | WIFUSD-OTC | PUT | 100% |
| DOTUSD | DOTUSD-OTC | PUT | 100% |
| SUIUSD | SUIUSD-OTC | PUT | 100% |
| XPTUSD | XPTUSD-OTC | PUT | 100% |
| ORDIUSD | ORDIUSD-OTC | CALL | 75% |
| HYPE | HYPE-OTC | CALL | 75% |
| TRON | TRON-OTC | CALL | 66.7% |
| SHIBUSD | SHIBUSD-OTC | PUT | 66.7% |
| RAYDIUMUSD | RAYDIUMUSD-OTC | CALL | 66.7% |

**Total:** 10 ativos OTC

---

## 🔄 Auto-Flip (Direção)

```javascript
if (consecutiveLosses >= autoFlipAfter) {
  // Muda direção do ativo
  direction = direction === 'CALL' ? 'PUT' : 'CALL';
}
```

---

## 📈 Filtros do Sistema

| Filtro | Status | Descrição |
|--------|--------|-----------|
| Regime Filter | ✅ | 10+ candles iguais = trending |
| Fade4 Pattern | ✅ | 4 candles contra + confirmação |
| RSI Filter | ✅ | CALL: RSI <= 45, PUT: RSI >= 55 |
| Volatility Filter | ✅ | Volatilidade mínima 0.0002 |
| IC-WR Gate | ✅ | IC >= 50% após 10 ops |
| Kill WR | ✅ | WR < 45% = ativo desabilitado |

---

## 🚀 Como Executar

```bash
# Entrar no diretório
cd "D:\Tracecom project"

# Executar
node ws-otc-v13.mjs

# Ou com timeout (para testes)
timeout 60 node ws-otc-v13.mjs
```

---

## 🔐 Segurança

### Arquivos com Credenciais (NUNCA COMPARTILHAR)
- `bot-config-v13.json` ❌
- Qualquer arquivo com email/senha ❌

### Arquivos Seguros para Backup
- `ws-otc-v13.mjs` ✅
- `iqoption-ws.mjs` ✅
- `bot-state-v13.json` ✅

---

## 📝 Notas Importantes

1. **Martingale ATIVO:** O multiplicador de 2.75x está ativo após 2 losses
2. **Early Sell ATIVO:** Venda antecipada ativada para proteger lucros
3. **Expiração 2min:** OTC usa 2 minutos (não 5 como binary normal)
4. **OTC apenas:** Todos os ativos são OTC (-OTC no nome)
5. **Warmup 2min:** Espera 2 minutos para coletar candles antes de operar

---

**Backup criado:** 2026-09-30  
**Versão:** v13  
**Status:** ✅ OPERACIONAL
