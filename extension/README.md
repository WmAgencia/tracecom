# TRACECON — Extensão de navegador (Down-bar)

A extensão injeta uma **down-bar fixa** no rodapé das corretoras suportadas
(TradingView, Binance, Exodus) com o sinal atual de análise (BUY / SELL /
WAIT), o ativo operado (detectado da URL/DOM) e a probabilidade de acerto.

**Importante:** a extensão **NÃO executa ordens**. Você clica manualmente o
botão BUY/SELL na corretora. O "modo automático" apenas atualiza o sinal a
cada 30 segundos.

## Como carregar (dev)

1. Inicie a API TRACECON local: `npm run serve` (porta 8788;
   `MARKET_DATA_MODE=binance` no `.env`).
2. No Chrome/Edge: `chrome://extensions` → ative **Modo do desenvolvedor** →
   **Carregar sem compactação** → selecione a pasta `extension/`.
3. Abra uma corretora (TradingView/Binance/Exodus). A down-bar aparece
   automaticamente no rodapé.
4. Clique no ícone da extensão → **Opções** para configurar backend, símbolos
   e modo auto-atualizar.

## Down-bar

```
┌─────────────────────────────────────────────────────────────────────┐
│ ● WAIT   BTCUSDT · tradingview-url  ·  1h   prob: 35.6%  @ 77650  │
│                                            [Atualizar] [Auto ━] [─] │
└─────────────────────────────────────────────────────────────────────┘
```

- **Sinal** com cor: verde=BUY, vermelho=SELL, azul=WAIT
- **Ativo detectado** automaticamente da URL (TradingView,
  Binance, Exodus) ou query string `?symbol=`
- **Timeframe** detectado do TradingView/Binance, com fallback 1h
- **Probabilidade de acerto** (prob. empírica ou confidence da análise)
- **Preço atual** ao lado do `@`
- **Atualizar**: força nova análise (ignora timer do auto)
- **Auto**: liga/desliga atualização automática (a cada 30s)
- **Minimizar** (`─`): colapsa para só o sinal + botão de expandir

Quando o sinal muda para BUY ou SELL: beep duplo + flash visual (sem clicar
em nada na página).

## Detecção de ativo (heurísticas conservadoras)

| Fonte | Padrão | Exemplo |
|---|---|---|
| TradingView | `/symbols/<EX>-<PAIR>/` na URL | `/symbols/BINANCE-BTCUSDT/` → `BTCUSDT` |
| Binance | `/trade/<BASE>_<QUOTE>` na URL | `/trade/BTC_USDT` → `BTCUSDT` |
| Genérico | `?symbol=`, `?asset=`, `?t=` | `?symbol=ETHUSDT` |
| Fallback | `<title>` com padrão `XXX/YYY` | `BTC/USDT - Binance` → `BTCUSDT` |

A extensão **nunca inventa** o ativo. Se não detectar, mostra erro e fica
aguardando.

## Configuração

A página de Opções aceita:
- URL do backend TRACECON local
- Auto-atualizar ligado/desligado
- Lista de ativos a monitorar
- Timeframe, direção, horizonte padrão da análise

Tudo fica em `chrome.storage.local` (não sai da sua máquina).

## Permissões

- `storage` — salvar opções
- `alarms` — polling de 30s quando auto=on
- `scripting` — extensão MV3 padrão
- `host_permissions`:
  - `http://127.0.0.1:*`, `http://localhost:*` (backend TRACECON local)
  - Corretoras: TradingView, Binance, Exodus
- **Sem `tabs`, sem `webNavigation`, sem `<all_urls>`**

## Arquivos

| Arquivo | Papel |
|---|---|
| `manifest.json` | MV3, content scripts só em corretoras |
| `background.js` | Service worker: alarm + API + cache de sinal |
| `content.js` | Injeta down-bar + detecta ativo + alerta sonoro |
| `downbar.css` | Estilos da down-bar (grafite + azul-elétrico) |
| `options.html/js/css` | Configurações |