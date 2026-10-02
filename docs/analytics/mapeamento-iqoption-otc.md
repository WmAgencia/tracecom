# Sessão 2026-09-27 — Mapeamento do terreno (IQ Option OTC)

## 0. Grade da sessão

spec=5 design=6 correctness=7 quality=6; biggest gap: nenhum dado OTC autêntico coletado — o MCP "Iq Option" não é acessível a este agente (roteado pelo backend Freebuff) e a sessão autenticada da traderoom não foi mediada.

## 1. O que o repo já contém (github.com/WmAgencia/tracecom)

Workspace local = clone do repo (origin aponta para ele). Inventário:

- **Integração IQ Option (read-only) já pronta**:
  - `src/market/providers/iqoption/provider.ts` — `IqOptionMarketProvider`: NÃO autentica, NÃO abre socket, NÃO envia ordens. Aceita frames normalizados (`heartbeat | tick | candle`) com validação de schema, sequência monotônica por (tab, ativo, tipo, timeframe), dedupe por timestamp, janelas de 2k candles / 5k ticks.
  - `src/market/providers/iqoption/symbol-resolver.ts` — normaliza `-OTC`/`_OTC`; OTC é distinto do Forex subjacente.
  - `extension/` (MV3) — ponte de traderoom: escuta **apenas** eventos `candle-generated` entrantes; nunca lê credenciais/SSID/cookies nem mensagens de saída; nunca clica em BUY/SELL. Forward → `POST /api/iq-option/ingest` (ativado com `MARKET_DATA_MODE=iqoption`). Instalação: `npm run build:extension` + "Load unpacked" em `dist-extension` (docs em `INSTALL-EXTENSION.md`).
- **Motor quantitativo + backtest + fusão**: `src/quant`, `src/backtest`, `src/fusion`, `src/analytics` (shadow validation causal, calibração Platt), CLI (`npm run quant|backtest|shadow-validation|decide`), API HTTP + UI (`npm run serve`, :8788).
- **Evidência anterior (spikes/diagnósticos)**:
  - `spike-results/SPIKE_REPORT_V2.md` (BTCUSDT 1h, 90d): motor TRACECON **0 trades em 90 dias**; causa raiz no `Backtester.probabilityForSetup` (edge médio **negativo**, -0.098); recomendação: consertar calibração/POC antes de qualquer ensemble.
  - `diagnostic-results/` (set/2026): 4 hipóteses (A threshold, B features, C OOS, D outcome) + CSVs de ablação/regime/sessão/símbolo para Forex — investigação de win-rate já em andamento.
- **Docker/Railway/Vercel** prontos; 66 arquivos de teste; `npm run typecheck` verde nesta sessão.

## 2. MCP "Iq Option" (`Iq Option WPMPEwG_E8iHtgzS2P__gRBI-dDNhSNccZmjvlVj`)

- **Ferramentas não puderam ser inventariadas nem chamadas**: o roteamento de MCPs acontece no backend Freebuff (nuvem), não exposto à sessão local. Investigações locais: config do Codex (`~/.codex/config.toml`) só tem `node_repl`; Freebuff desktop (`%APPDATA%/Freebuff`) não guarda config de MCP; orquestrador local (`127.0.0.1:59770`) tem rotas `/api/mcp/servers` porém `unauthorized`; nenhum processo `mcp-*` no host; nenhum pacote npm público `iqoption-mcp`/`iq-option-mcp`.
- **Contexto técnico** (biblioteca `iqoption` de LuKks, referência de protocolo): WebSocket autenticado com eventos `candle-generated` (1m/5m/…), ativos por `active_id` (ex.: **76 = EUR/USD-OTC**), lista de assets via arquivo embutido no client. Autenticação exige login/SSID — **o caminho suportado no repo é a extensão read-only** (que observa a sessão do usuário sem nunca tocar em ordens).
- **Descoberta de ambiente**: app desktop IQ Option instalado e rodando (`IQTray.exe`), mas protocolo binário próprio sem API aproveitável; `api.iqoption.com/api/v1/*` e `iqoption.com/initial-feed` respondem 404/301 (endpoints públicos antigos desativados).

## 3. Dados coletados nesta sessão (todos reais, sem credenciais, sem ordens)

`diagnostic-results/data/` — 18 CSVs + `MANIFEST.json` (189.362 linhas):

| Grupo | Ativos | Timeframes | Janela obtida | Qualidade |
|---|---|---|---|---|
| Forex (Yahoo, subjacente dos OTC) | EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, NZD/USD | 1h | ~365d (6.092–6.158 candles) | high; gaps = fins de semana |
| Forex 1m | idem | 1m | ~7d (7.072–7.102) | high; **AUD/NZD 1m degradados** (Yahoo entregou 2min) |
| Cripto (Binance REST) | BTCUSDT, ETHUSDT | 1h / 1m | 365d (8.760) / 30d (~43.2k) | high, 0 gaps |

- Coletor versionado: `spike-results/collect_base_data.mts` (idempotente, anota gaps via espaçamento modal, marca degradação de granularidade, `process.exitCode=1` se faltar arquivo).
- ⚠️ **Estes NÃO são feeds OTC**: são os subjacentes reais. OTC da IQ só é observável dentro de sessão autenticada (extensão read-only é a ponte suportada).

## 4. Caminho para os dados OTC de verdade (próximos passos)

1. **Habilitar o MCP no ambiente** (ou informar como chamá-lo) — hoje não aparece para este agente.
2. **Ou ativar a ponte read-only**: `MARKET_DATA_MODE=iqoption` + `npm run serve` + carregar `dist-extension` no Chrome com sessão da traderoom aberta (a extensão encaminha candles/ticks; o backend persiste). Enquanto isso, dá para rodar coleta passiva 24/7 e acumular OTC real.
3. Uma vez com candles OTC persistidos, o pipeline existente (`backtest`, `shadow-validation`) já calcula win rate empírico com split OOS — os diagnósticos de setembro já apontam que o gargalo é a calibração do Backtester, não a ausência de sinais.

## 5. Riscos e honestidade analítica

- OTC da IQ é sintético controlado pela casa: padrões "descobertos" nele podem não transferir e a casa pode ver o fluxo; qualquer edge < payout (~85%) vira prejuízo esperado.
- Sem dados OTC autênticos, nenhuma afirmação sobre win rate de OTC é testável — o objetivo de 70% fica **sem base verificável** nesta sessão.
- Nenhuma ordem real foi aberta; nenhuma credencial foi solicitada/registrada.
