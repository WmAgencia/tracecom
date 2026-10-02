# oTrace.com - Sistema de Backup e Documentação do Bot OTC

> **Data do Backup:** 2026-09-30  
> **Última revisão:** 2026-10-01 (contas identificadas + bot corrigido)  
> **Versão do Bot:** v13  
> **Status:** ✅ OPERANDO (configuração corrigida em 2026-10-01)

---

## 💼 Contas IQ Option (identificadas em 2026-10-01)

| Conta | `type` | **id** | Moeda | Saldo | Observação |
|-------|--------|--------|-------|-------|------------|
| **DEMO** (PRACTICE) | `4` | **1250741747** | `USD` | **US$ 60,00** | é a conta 4; usada pelo comando `node ws-otc-v13.mjs demo` |
| **REAL** | `1` | **1250741746** | `BRL` | **R$ 0,00** | o valor de R$ 1,31 é **bônus** (`bonus_amount`), não saldo disponível |

- Identificação feita via `get-balances` (somente leitura) em 2026-10-01 — nenhuma ordem enviada.
- O bot escolhe a conta pelo **`type`**: `demo` → type 4 · `real` → type 1 · (`2` = torneio).
- A conta **DEMO é em dólar**: o bot agora imprime a moeda real da conta (`US$`) em vez de "R$" fixo.
- A conta **REAL está sem saldo disponível** (bônus não serve para operar); o bot recusa iniciar nessa condição (fail-closed).

---

> ⚠️ **As seções abaixo descrevem a versão ANTIGA do bot** (martingale 2,75x, RSI 45/55, regime 10) e ficam como histórico.
>
> **Versão atual: V14** (`ws-otc-v14.mjs` + `bot-config-v14.json`): stake base 2 · escada **2 → 4,33 → 9,36**
> pelo payout de 86% (qualquer degrau que ganha fecha +1,72 e cobre o prejuízo) · máximo **3 entradas** (base + 2
> martingales) · pausa de 10 min no ativo · trava de 20 por ordem · **RSI CALL<=35 / PUT>=65** ·
> **regime bloqueia 10+ candles iguais** · auto-flip após 2 losses · **early sell por reversão** (vende antes do
> vencimento só quando o preço reverte contra a posição; se a trajetória continua a favor, deixa dar o win) ·
> sinal só em candle fechado · 1 operação por ativo.
>
> Rodar: `node ws-otc-v14.mjs demo` (a conta DEMO é em **US$**). As cópias antigas ficam em
> `oTrace.com/backup/historico-2026-09-30/` (v13 pré-correção) e `oTrace.com/backup/historico-2026-10-01-v13/` (v13 corrigida).

---

## 📁 Estrutura do Backup

```
oTrace.com/
├── backup/                    # Cópias de segurança dos arquivos críticos
│   ├── bot-config-v13.json   # Configurações do bot (VERSÃO REAL)
│   ├── bot-state-v13.json    # Estado atual do aprendizado
│   ├── learning-state.json   # Estado de aprendizado
│   ├── ws-otc-v13.mjs        # Código fonte do bot principal
│   ├── iqoption-ws.mjs       # Cliente WebSocket IQ Option
│   └── package.json           # Dependências do projeto
│
├── docs/                     # Documentação
│   ├── VERIFICACAO-SISTEMA.md # Relatório de verificação
│   └── README-SISTEMA.md     # Documentação detalhada
│
└── README.md                 # Este arquivo
```

---

## 🚀 Como Rodar o Bot

### 1. Pré-requisitos

- **Node.js:** >= 22.0.0
- **Conta IQ Option:** Conta DEMO ou REAL
- **Arquivos de configuração:** `bot-config-v13.json`

### 2. Comandos para Executar

```bash
# Navegar até o diretório
cd "D:\Tracecom project"

# Executar o bot (V14)
node ws-otc-v14.mjs demo     # conta DEMO (US$)
node ws-otc-v14.mjs real     # conta REAL (R$)

# Ou com timeout (para testes)
timeout 60 node ws-otc-v14.mjs demo
```

### 3. Para Restaurar o Backup

```bash
# Copiar os arquivos de backup de volta (listados um a um)
cp oTrace.com/backup/bot-config-v13.json oTrace.com/backup/ws-otc-v13.mjs \
   oTrace.com/backup/iqoption-ws.mjs oTrace.com/backup/package.json ./

# Verificar se estão no lugar
ls -la bot-config-v13.json ws-otc-v13.mjs
```

> Em `oTrace.com/backup/historico-2026-09-30/` ficam as cópias ANTIGAS (bot com martingale 2,75x que
> gerou stakes astronômicos). **Não restaurar** — servem apenas como histórico.

---

## ⚙️ Configurações do Bot (bot-config-v13.json)

### Estrutura Completa

```json
{
  "_version": "13",
  "_desc": "Bot v13 - Auto-flip + Martingale + Early Sell + RSI estrito",

  "login": {
    "email": "SEU_EMAIL",
    "password": "SUA_SENHA"
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

### Explicação de Cada Campo

#### 🔐 Login
| Campo | Descrição |
|-------|-----------|
| `email` | Email da conta IQ Option |
| `password` | Senha da conta |

#### 💰 Trading (Negociação)
| Campo | Valor Padrão | Descrição |
|-------|--------------|-----------|
| `baseStake` | 2 | Valor base da aposta em dólares |
| `expirationMinutes` | 2 | Tempo de expiração em minutos (OTC usa 2min) |
| `reportIntervalMs` | 300000 | Intervalo de relatório (5 min) |
| `maxConcurrentOps` | 5 | Máximo de operações simultâneas |

#### 📊 Strategy (Estratégia)
| Campo | Valor Padrão | Descrição |
|-------|--------------|-----------|
| `candleSizeSeconds` | 5 | Tamanho do candle em segundos |
| `lookbackRegime` | 20 | Candles para detectar regime |
| `regimeStreakThreshold` | 10 | Se >= 10 candles na mesma direção = trending |
| `rsiPeriod` | 14 | Período do RSI |
| `rsiCallThreshold` | 45 | RSI <= 45 para permitir CALL |
| `rsiPutThreshold` | 55 | RSI >= 55 para permitir PUT |
| `volatilityMin` | 0.0002 | Volatilidade mínima (filtro) |
| `icLowerGate` | 0.50 | Intervalo de confiança mínimo (50%) |
| `warmupMs` | 120000 | Tempo de aquecimento (2 minutos) |
| `min1mCandles` | 2 | Mínimo candles 1min |
| `staleCandleMs` | 30000 | Candle stale após 30s |

#### 🧠 Learning (Aprendizado)
| Campo | Valor Padrão | Descrição |
|-------|--------------|-----------|
| `minSampleSize` | 10 | Mínimo de operações antes de avaliar WR |
| `killWR` | 0.45 | WR < 45% = mata ativo |
| `weightHistorical` | 0.3 | Peso histórico (30%) |
| `weightObserved` | 0.7 | Peso observado (70%) |
| `recalibrateAfter` | 15 | Recalibra após 15 ops |
| `autoFlipAfter` | 2 | Auto-flip após 2 losses |
| `martingaleAfter` | 2 | Martingale após 2 losses |
| `martingaleMultiplier` | 2.75 | Multiplicador martingale |

#### 🎯 Early Sell (Venda Antecipada)
| Campo | Valor Padrão | Descrição |
|-------|--------------|-----------|
| `enabled` | true | Venda antecipada ATIVADA |
| `checkIntervalMs` | 10000 | Verifica a cada 10 segundos |
| `minProfitToSell` | 0.15 | Mínimo 15% lucro |
| `profitPercentToSell` | 0.50 | Vende se lucrar 50% do máximo |
| `minSecondsBeforeSell` | 20 | Mínimo 20s antes de vender |
| `maxSecondsBeforeSell` | 100 | Máximo 100s antes de vender |

#### ✅ Whitelist (Ativos Permitidos)
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

---

## 🎰 Sistema de Martingale

### Como Funciona

```
BASE STAKE = $2

Após 1 LOSS:
  └── Stake = $2 (mantém)

Após 2 LOSSES:
  └── Stake = $2 × 2.75 = $5.50 (MARTINGALE ATIVA!)
  └── Direção pode ser FLIPADA (autoFlip)

Após 3+ LOSSES:
  └── Stake = $5.50 × 2.75 = $15.13
  └── OU desabilita ativo se WR < 45%
```

### ⚠️ Importante

O sistema USA martingale real com multiplicador 2.75x! Após 2 losses:
- Stake sobe para $5.50
- Direção pode inverter automaticamente

### Intervalo de Confiança (IC)

```
IC = Intervalo de Confiança de Wilson Score

Se total >= 10 operações E IC.lower < 50%:
  └── Ativo é DESABILITADO

Se IC.lower >= 50%:
  └── Ativo continua operando
```

---

## 🔄 Auto-Flip (Direção Automática)

```javascript
// Após 2 losses, a direção é invertida
if (consecutiveLosses >= autoFlipAfter) {
  direction = direction === 'CALL' ? 'PUT' : 'CALL';
}
```

---

## 🎯 Early Sell (Venda Antecipada)

O bot vende automaticamente quando:
- Lucro atual >= 15% do investimento
- E o lucro atual >= 50% do lucro máximo já atingido
- E passou pelo menos 20 segundos desde a abertura
- E ainda faltam pelo menos 20 segundos para expirar

---

## 📊 Filtros do Bot

O bot usa **6 camadas de filtro** antes de operar:

### 1. Regime Filter
```
Usa os últimos 20 candles de 5s
Se 10+ candles seguidos na mesma direção → BLOQUEIA (trending)
Se não → CONTINUA (ranging)
```

### 2. Fade4 Pattern
```
4 candles contra a direção + 5º candle confirmando reversão
CALL: 4 candles DESCENDO + 5º candle SUBINDO
PUT: 4 candles SUBINDO + 5º candle DESCENDO
```

### 3. RSI Filter
```
CALL: RSI <= 45 (não sobrecomprado)
PUT: RSI >= 55 (não sobrevendido)
```

### 4. IC-WR Gate
```
Após 10 operações:
  Se IC.lower >= 50% → CONTINUA
  Se IC.lower < 50% → BLOQUEIA
```

### 5. Kill WR
```
Se WR observado < 45%:
  Ativo é DESABILITADO
```

### 6. Volatility Filter
```
Volatilidade mínima: 0.0002
Se volatilidade < 0.0002 → BLOQUEIA
```

---

## 🔌 API WebSocket (iqoption-ws.mjs)

### Métodos Principais

| Método | Descrição |
|--------|-----------|
| `connect({ ssid })` | Conecta ao WebSocket da IQ Option |
| `subscribeCandles(activeId, size)` | Assina candles em tempo real |
| `getBalances()` | Busca saldos das contas |
| `getInitializationData()` | Busca dados iniciais (ativos, IDs) |
| `getCandlesHistory({ activeId, size, count })` | Busca candles históricos |
| `send(name, msg, requestId)` | Envia mensagem genérica |
| `close()` | Fecha conexão |

### Mensagens de Evento

| Evento | Descrição |
|--------|-----------|
| `ready` | WebSocket conectado e pronto |
| `candle-generated` | Novo candle recebido |
| `socket-option-opened` | Opção foi aberta |
| `socket-option-closed` | Opção foi fechada (resultado) |
| `profile` | Perfil do usuário |
| `timeSync` | Sincronização de tempo |

---

## 📋 Como Adicionar um Novo Ativo

### 1. Editar `bot-config-v13.json`

Adicionar na seção `whitelist`:

```json
"NEWMETRIC": {
  "name": "front.NEWMETRIC-OTC",
  "direction": "CALL",
  "wr": 70
}
```

### 2. Reiniciar o Bot

```bash
node ws-otc-v13.mjs
```

O bot automaticamente:
- Inicializa o estado do ativo
- Começa a monitorar
- Adiciona à whitelist interna

---

## 🔧 Manutenção

### Backup Manual

```bash
# Criar backup
cp bot-config-v13.json oTrace.com/backup/
cp bot-state-v13.json oTrace.com/backup/

# Verificar backup
ls oTrace.com/backup/
```

### Limpar Resultados Antigos

```bash
# Renomear resultados
mv resultados-v13.json resultados-v13-$(date +%Y%m%d).json

# O bot cria novo arquivo automaticamente
```

---

## ⚠️ Códigos de Erro

| Código | Significado |
|--------|-------------|
| `WS_CONNECT_TIMEOUT` | Timeout ao conectar |
| `WS_SOCKET_ERROR` | Erro no socket |
| `TIME_SYNC_TIMEOUT` | Timeout sincronizando tempo |
| `SSID_REQUIRED` | SSID de login não fornecido |
| `WS_NOT_CONNECTED` | Tentativa de enviar sem conexão |

---

## 📈 Monitoramento

### Saída do Console

```
[LOGIN] OK!
[WS] Ready!
[💼 CONTA] DEMO | Saldo: $10000.00
[📡] Assinando RENDER/USD-OTC (ID: ?)
[⏳] Warmup 120s...
[✅] INICIADO! Stake: $2

[📊 RENDER/USD] CALL RSI:42 regime:ranging IC:78.0%-95.0% exp:1790808600
[✅ ABERTURA] RENDER/USD | CALL | $2 | exp:1790808600
[✅] RENDER/USD | CALL | $2 | RSI:42 | +$1.64 | win
[📈] Total: 1 | WR: 100.0% | Lucro: $1.64
```

### Status Bar (a cada 30s)

```
⏱ 14:30:00 Ops:15 WR:67% Lucro: $12.50
```

---

## 🔐 Segurança

### Nunca Compartilhe

- ❌ `bot-config-v13.json` (contém email/senha)
- ❌ `iqoption-ws.mjs` (pode ter segredos)
- ❌ Tokens de API

### Arquivos Seguros para Backup

- ✅ `ws-otc-v13.mjs` (código fonte)
- ✅ `bot-state-v13.json` (estado - não contém credenciais)

---

## 📞 Suporte

Para dúvidas sobre o sistema:
1. Leia este README
2. Verifique os logs do console
3. Check o arquivo `resultados-v13.json`

---

## ✅ Status do Sistema

| Componente | Status |
|------------|--------|
| Martingale | ✅ ATIVO (2.75x após 2 losses) |
| Auto-Flip | ✅ ATIVO (após 2 losses) |
| Early Sell | ✅ ATIVO (50% do máximo) |
| RSI Filter | ✅ ATIVO (CALL<=45, PUT>=55) |
| Regime Filter | ✅ ATIVO (10 candles) |
| IC-WR Gate | ✅ ATIVO (50%) |
| Kill WR | ✅ ATIVO (45%) |

---

**Versão:** v13  
**Última Atualização:** 2026-09-30  
**Autor:** Sistema oTrace.com
