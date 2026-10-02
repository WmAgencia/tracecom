# TraceBot Dashboard

Dashboard React para monitoramento do bot de trading.

## 🚀 Quick Start

```bash
npm install
npm run dev      # Desenvolvimento (http://localhost:5173)
npm run build    # Build production
npm run start    # Rodar servidor de produção (server.mjs)
```

## 🌐 Deploy no Railway

```bash
# Login
railway login

# Linkar projeto (só precisa uma vez)
railway init

# Deploy
railway up --service desirable-connection
```

## 📁 Estrutura

```
src/
├── components/       # Componentes React
│   ├── Header.jsx
│   ├── MetricCard.jsx
│   ├── PerformanceChart.jsx
│   ├── TradeHistory.jsx
│   ├── SettingsPanel.jsx
│   ├── AssetMap.jsx
│   └── DebugPanel.jsx
├── hooks/
│   └── useBotStatus.js   # Hook principal de estado
├── api/
│   └── botApi.js         # Comunicação com API
└── App.jsx
```

## 🔌 API Endpoints

O servidor (`server.mjs`) expõe:

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/api/health` | GET | Health check |
| `/api/status` | GET | Status do bot |
| `/api/trades` | GET | Histórico de operações |
| `/api/state` | GET | Estado por ativo |
| `/api/config` | GET | Configuração (sem senha) |
| `/api/update` | POST | Recebe dados do bot (telemetria) |

## 📤 Atualizar Bots

O dashboard no Railway precisa de um cliente de telemetria rodando na máquina do bot:

```bash
cd "D:/Tracecom project"
node bot-telemetry.mjs
```

O `bot-telemetry.mjs` lê os arquivos JSON do bot e envia para o Railway.
