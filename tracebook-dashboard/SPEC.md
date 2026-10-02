# SPEC — TraceBot Dashboard (Web Frontend)

> Painel web para controlar e monitorar o bot V16 em tempo real.

---

## 1. VISÃO GERAL

**Stack:** React 18 + Vite + TailwindCSS + Recharts  
**Arquitetura:** SPA que consome a API REST do servidor de métricas embutido no bot (ou polling dos JSONs de estado)  
**Tema:** Dark, inspirado em terminais de trading profissional (prata/cyan/dourado sobre fundo #0a0e17)  
**Target:** Operador que quer ver tudo em tempo real e ajustar configurações sem editar JSON na mão  

---

## 2. ARQUITETURA

### 2.1 Duas opções de integração com o bot

#### Opção A: Servidor HTTP embutido no bot (recomendado)
O bot ganha um mini servidor HTTP (porta 3456) que expõe:
```
GET /api/status          → stats, open positions, universe size
GET /api/trades          → últimos N resultados
GET /api/config          → config atual (sem senha)
POST /api/config         → atualiza config (valida antes de salvar)
GET /api/state           → estado por ativo
WS  /ws                  → stream em tempo real (stats, trades, posições)
```

#### Opção B: Polling de arquivos (sem modificar o bot)
O frontend polls os JSONs existentes (`bot-state-v15.json`, `resultados-v15.json`) via API própria. Menos intrusivo mas menos realtime.

### 2.2 Recomendação

**Opção A** — o servidor HTTP é simples (30-50 linhas), não interfere no WebSocket da IQ, e permite push realtime via WebSocket.

---

## 3. TELAS / SEÇÕES

### 3.1 Header (fixo no topo)

```
┌─────────────────────────────────────────────────────────────────────┐
│  [logo] TraceBot V16   │  DEMO  │  US$60.00  │  ⏱ 04:47  │  🟢  │
└─────────────────────────────────────────────────────────────────────┘
```

- Logo + versão
- Conta (DEMO/REAL) com badge colorido
- Saldo atual com delta desde o boot
- Tempo de sessão
- Indicador de status: 🟢 operando / 🟡 warmup / 🔴 parado

---

### 3.2 Barra de Métricas (4 cards grandes)

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   WIN RATE   │  │   P/L LÍQUIDO │  │  OPERACÕES   │  │  CANDLES     │
│              │  │              │  │              │  │              │
│    68.4%    │  │  +R$12,40   │  │    47/23     │  │   4.629      │
│   ▓▓▓▓▓▓░░  │  │  ▓▓▓▓▓▓▓░░  │  │  70 ops/min  │  │   +127/seg   │
│   32W / 15L │  │  meta: R$1K │  │  0 abertas   │  │  170/170 uni │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

Cada card:
- Valor principal grande
- Barra de progresso ou mini gráfico sparkline
- Indicadores secundários
- Hover: tooltip com mais detalhes

---

### 3.3 Painel de Operações Abertas

Lista de posições em voo com:

| Ativo | Direção | Stake | Tempo Restante | Cotação | P/L Projetado | Ações |
|-------|---------|-------|----------------|---------|--------------|-------|

- Barra de progresso do tempo restante
- Cotação atual (sell_profit)
- P/L projetado (verde/vermelho)
- Botão: **[Vender agora]** (chama sell manual)
- Badge de pyramid se >1 posição no mesmo ativo

---

### 3.4 Gráfico de Desempenho

```
┌─────────────────────────────────────────────────────────────────────┐
│  P/L ACUMULADO                              [1M] [5M] [15M] [ALL] │
│                                                                      │
│     R$15 ┤                                         ┌────             │
│          │                           ┌────┐  ┌────┐                   │
│     R$ 0 ┤  ─────────────────────┬────────────┘                          │
│          │                       │                                        │
│    -R$5  ┤                       │                                        │
│          │                       │                                        │
│    -R$10 ┤                       │                                        │
│          └────────────────────────────────────────────────────        │
│           00:00   00:30   01:00   01:30   02:00   02:30   03:00        │
└─────────────────────────────────────────────────────────────────────┘
```

- Acumulado (não por operação)
- Zoom temporal: 1M, 5M, 15M, 1H, ALL
- Hover: mostra o valor exato e o que aconteceu naquela hora
- Cores: verde acima de zero, vermelho abaixo
- Marcação de drawdown máximo

---

### 3.5 Histórico de Operações

Tabela com ordenação, filtro e busca:

```
┌──────┬────────┬────┬────────┬────────┬───────┬──────────┬────────────┐
│ Hora │ Ativo  │ D │ Result │ Stake  │  P/L  │  Tipo    │  Motivo    │
├──────┼────────┼────┼────────┼────────┼───────┼──────────┼────────────┤
│ 04:47│ WIFUSD │ C  │  WIN   │ R$2.00 │ +1.72 │ entrada  │ alta 0.12%│
│ 04:44│ RENDER │ C  │  LOSS  │ R$2.00 │ -2.00 │ gale #1  │ alta 0.08%│
│ 04:42│ DOTUSD │ P  │  WIN   │ R$2.00 │ +1.72 │ pyramid  │ baixa 0.15%│
└──────┴────────┴────┴────────┴────────┴───────┴──────────┴────────────┘
```

- Direção com cor (CALL = verde, PUT = vermelho)
- Resultado com badge colorido
- Tipo: entrada / gale#1 / gale#2 / pyramid
- Motivo: sinal que disparou
- Filtros: W/L/All, tipo, direção, range de horário
- Busca por nome do ativo
- Exportar CSV

---

### 3.6 Painel de Configuração (Settings)

**5 abas:**

#### 3.6.1 Trading
| Campo | Tipo | Range | Default |
|-------|------|-------|---------|
| baseStake | number | 0.5–20 | R$2.00 |
| expirationMinutes | select | 1/2/3/5 | 2 min |
| maxOpsPerAsset | number | 1–5 | 3 |
| galeWindowMs | number | 30s–5min | 2 min |

#### 3.6.2 Estratégia
| Campo | Tipo | Range | Default |
|-------|------|-------|---------|
| adxMin | slider | 10–40 | 20 |
| rsiCallMax | slider | 40–70 | 55 |
| rsiPutMin | slider | 30–60 | 45 |
| regimeStreakThreshold | number | 5–20 | 12 |
| trendMinEmaSpreadPct | number | 0.02–0.20 | 0.06 |

#### 3.6.3 Venda
| Campo | Tipo | Range | Default |
|-------|------|-------|---------|
| takeProfitMode | toggle | SCALP / NORMAL | NORMAL |
| takeProfitPctOfStake | slider | 10–50% | 20% |
| endgameAfterMs | slider | 20s–60s | 40s |
| endgameBeforeMs | slider | 10s–30s | 20s |
| minRecover | number | R$0.10–2.00 | R$0.50 |
| distanceFactor | slider | 1–8× | 4× |
| earlyGaleEnabled | toggle | on/off | on |
| earlyGaleThreshold | number | R$0.20–2.00 | R$0.80 |

#### 3.6.4 Risco
| Campo | Tipo | Range | Default |
|-------|------|-------|---------|
| maxExposurePct | slider | 10–80% | 50% |
| maxSessionLossPct | slider | 5–30% | 20% |
| maxStake | number | 5–100 | R$20 |

#### 3.6.5 Universo
| Campo | Tipo | Range | Default |
|-------|------|-------|---------|
| minActive | number | 50–200 | 170 |
| maxActive | number | minActive–250 | 200 |
| replaceStaleMs | slider | 1min–10min | 3 min |
| checkEveryMs | slider | 10s–5min | 30s |

**Validação:** cada campo tem validação client-side + server-side antes de salvar.  
**Preview:** ao mudar um valor, mostra visualmente o impacto ("Isso vai bloquear ~30% mais entradas").  
**Reset:** botão de resetar para defaults.  
**Persistência:** botão **[Aplicar + Reiniciar Bot]** salva no JSON e reinicia.

---

### 3.7 Mapa de Ativos (Universo)

Grid visual mostrando todos os ativos do universo:

```
┌──────────────────────────────────────────────────────────┐
│  🟢 operando (170)   🟡 sem candle   🔴 banido/suspenso  │
├──────────────────────────────────────────────────────────┤
│  🟢 WIFUSD  🟢 RENDER  🟢 DOTUSD  🟢 SUIUSD  🟢 ORDI    │
│  🟢 HYPE    🟡 XPTUSD  🟢 SHIBUSD 🟢 BTCUSD  🟢 ETHUSD │
│  ...                                                  │
└──────────────────────────────────────────────────────────┘
```

- Cor por status: operando / sem candle fresco / banido temporariamente
- Click: abre modal com detalhes do ativo (direção, RSI, ADX, regime, última operação)
- Indicador de tendência: ▲ (CALL) / ▼ (PUT) / ➖ (lateral)
- Top 10 com badge especial (⭐)

---

### 3.8 Painel de Debug (colapsável)

Para diagnóstico avançado:
- Últimas 50 mensagens WebSocket brutas
- Estado de cada buffer por ativo
- Logs do servidor de métricas
- Botão: **[Copiar diagnóstico]** (gera texto para enviar ao suporte)

---

## 4. DESIGN SYSTEM

### 4.1 Cores

```
Background:     #0a0e17  (fundo principal)
Surface:        #111827  (cards, modais)
Surface-alt:   #1a2235  (linhas alternadas, hover)
Border:         #1e2d40  (bordas sutis)
Text-primary:   #e2e8f0  (texto principal)
Text-secondary: #64748b  (labels, descrições)
Accent-cyan:    #22d3ee  (métricas principais, destaques)
Accent-green:   #34d399  (win, CALL, lucro)
Accent-red:     #f87171  (loss, PUT, prejuízo)
Accent-yellow:  #fbbf24  (alertas, warns)
Accent-gold:    #f59e0b  (resultados)
```

### 4.2 Tipografia

```
Font:    "JetBrains Mono" para números/código, "Inter" para texto
Headings: 600–700 weight
Dados:    tabular-nums, monospace para alinhamento de números
```

### 4.3 Animações

- Contadores: contagem animada (números sobem/descem suavemente)
- Cards: hover com leve elevação (box-shadow)
- Tabela: linhas novas aparecem com fade-in lateral
- Gráfico: linha se desenha progressivamente no load
- Modais: fade + scale de 0.95 → 1.0

---

## 5. IMPLEMENTAÇÃO

### 5.1 Arquivos do frontend

```
tracebook-dashboard/
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── api/
│   │   └── botApi.js           # chamadas ao servidor de métricas
│   ├── components/
│   │   ├── Header.jsx
│   │   ├── MetricCard.jsx
│   │   ├── OpenPositions.jsx
│   │   ├── PerformanceChart.jsx
│   │   ├── TradeHistory.jsx
│   │   ├── SettingsPanel.jsx
│   │   ├── AssetMap.jsx
│   │   ├── DebugPanel.jsx
│   │   └── common/
│   │       ├── Toggle.jsx
│   │       ├── Slider.jsx
│   │       ├── Badge.jsx
│   │       └── Modal.jsx
│   ├── hooks/
│   │   ├── useBotStatus.js     # polling / WebSocket
│   │   └── useConfig.js
│   └── styles/
│       └── index.css
├── index.html
├── package.json
├── vite.config.js
└── tailwind.config.js
```

### 5.2 Servidor de métricas (bot addon)

30–50 linhas no `ws-otc-v15.mjs`:

```javascript
// Servidor de métricas HTTP (porta 3456) — não interfere no WS da IQ
import http from 'http';
const METRICS_PORT = 3456;
const metricsServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/api/status') {
    res.end(JSON.stringify({ stats, openCount: inFlight.size, universe: running.size, warmupDone, accountType, currencySymbol, currentBalance }));
  } else if (req.method === 'GET' && req.url === '/api/trades') {
    res.end(JSON.stringify(resultsList.slice(-200)));
  } else if (req.method === 'GET' && req.url === '/api/config') {
    const { password, ...safeConfig } = CONFIG;
    res.end(JSON.stringify(safeConfig));
  } else {
    res.statusCode = 404; res.end('{"error":"not found"}');
  }
});
metricsServer.listen(METRICS_PORT, () => logLine(`[🌐] métricas HTTP em http://localhost:${METRICS_PORT}`));
```

---

## 6. OUTRAS FUNÇÕES

- **Kill switch remoto**: botão para parar o bot pelo navegador
- **Exportar resultados**: CSV/JSON do histórico de operações
- **Notificações**: toast de nova operação, resultado, erro
- **Responsivo**: funcional em desktop e tablet (não mobile — trading precisa de tela)
- **Sound**: som ao fechar operação (opcional, toggle no header)
- **Tema**: dark (default) / light (alternativa)
- **Favoritos**: marcar ativos para assistir de perto
