# TraceCom - Robô de Opções Binárias

Sistema automatizado de trading com dashboard de monitoramento.

## 📁 Estrutura de Arquivos

```
D:/Tracecom project/
├── tracebook-dashboard/     # Dashboard React (deploy no Railway)
│   ├── src/                 # Código fonte React
│   │   ├── components/      # Componentes UI
│   │   ├── hooks/           # Hooks React (useBotStatus)
│   │   └── api/             # Comunicação com API
│   ├── server.mjs           # Servidor Node (proxy + dashboard)
│   ├── proxy.mjs            # Proxy de métricas (legacy)
│   ├── dist/                # Build production
│   └── railway.json         # Config Railway
│
├── bot-telemetry.mjs        # Envia dados do bot pro Railway
├── ws-otc-v16.mjs          # Bot principal v16
├── ws-otc-v15.mjs          # Bot v15 (backup)
├── ws-otc-v13.mjs          # Bot v13 (backup)
├── bot-state-v16.json       # Estado do bot
├── bot-config-v16.json      # Configuração
└── resultados-v16.json      # Histórico de operações
```

## 🚀 Como Rodar Localmente

### 1. Dashboard Local (sem Railway)

```bash
cd "D:/Tracecom project/tracebook-dashboard"
npm install
npm run dev
# Abre em http://localhost:5173
```

### 2. Telemetria (envia dados pro Railway)

```bash
cd "D:/Tracecom project"
node bot-telemetry.mjs
```

O bot de telemetria lê os arquivos JSON do bot e envia pro dashboard online a cada 5 segundos.

### 3. Bot de Trading

```bash
cd "D:/Tracecom project"
node ws-otc-v16.mjs
```

## 🌐 Dashboard Online (Railway)

**URL:** https://desirable-connection-production-ef1a.up.railway.app/

O dashboard conecta automaticamente na API do Railway (`/api/status`, `/api/trades`, etc).

### Para o dashboard funcionar, você precisa:

1. **Rodar o bot de telemetria na sua máquina:**
   ```bash
   node D:/Tracecom\ project/bot-telemetry.mjs
   ```

2. **O bot principal também precisa estar rodando:**
   ```bash
   node D:/Tracecom\ project/ws-otc-v16.mjs
   ```

## 📤 Subir Atualizações para Produção

### Dashboard (Railway)

Quando quiser atualizar o dashboard online:

```bash
cd "D:/Tracecom project/tracebook-dashboard"

# Build + deploy
npm run build && npx railway up --service desirable-connection
```

### Arquivos Criados

O deploy no Railway usa:
- `server.mjs` - Servidor que rodará no Railway
- `dist/` - Build do React

## ⚙️ Configuração

### Variáveis de Ambiente

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `PROXY_URL` | URL do Railway | `https://desirable-connection-production-ef1a.up.railway.app` |
| `BOT_DIR` | Pasta do bot | `D:/Tracecom project` |
| `PORT` | Porta local | `3000` (Railway usa `8080`) |

### Configuração do Bot

O arquivo `bot-config-v16.json` contém:
- `trading.baseStake` - Stake base (R$2)
- `estrategia.adxMin` - Filtro ADX mínimo
- `venda.takeProfitPctOfStake` - % do stake para take profit
- `risco.maxExposurePct` - Exposição máxima
- E mais...

## 🔧 Troubleshooting

### Dashboard não conecta
1. Verifique se `bot-telemetry.mjs` está rodando
2. Verifique se o bot principal está rodando
3. Teste a API: `curl https://desirable-connection-production-ef1a.up.railway.app/api/health`

### Erro CORS
O servidor já tem CORS habilitado para todas as origens.

### Railway não atualiza
```bash
cd "D:/Tracecom project/tracebook-dashboard"
npx railway logs  # Ver logs
npx railway status  # Ver status
```

## 📝 Fluxo de Trabalho

1. **Desenvolvimento local:**
   - Edite o código em `tracebook-dashboard/src/`
   - Teste com `npm run dev`

2. **Teste de bot:**
   - Edite os bots em `ws-otc-v*.mjs`
   - Teste localmente

3. **Deploy:**
   - Quando aprovado, rode `npx railway up` na pasta `tracebook-dashboard`
   - O dashboard atualiza em ~30 segundos

## 🔗 Links Úteis

- [Railway Dashboard](https://railway.com/project/b08ad89f-d6b4-4684-af21-7487211a50d5)
- [TraceBot Online](https://desirable-connection-production-ef1a.up.railway.app/)
