# TRACECON — Extensão de navegador (Side Panel)

A extensão é a principal interface do produto: abre um painel lateral (Side
Panel, MV3) ao lado da corretora real e recebe análises em tempo real da API
local TRACECON. **NÃO executa ordens; não é corretora; não fabrica dados.**

## Como carregar (dev)

1. Inicie a API TRACECON: `npm run serve` (porta 8788; `MARKET_DATA_MODE=binance`).
2. No Chrome/Edge: `chrome://extensions` → ative "Modo do desenvolvedor" →
   "Carregar sem compactação" → selecione a pasta `extension/`.
3. Abra uma corretora real (TradingView / Binance / Exodus) e clique no
   ícone TRACECON → painel lateral.

## Detecção da plataforma

O `content.js` tenta identificar plataforma/ativo/timeframe **apenas por
marcadores verificáveis** (URLs `trade/pair` da Binance, `symbol/interval` do
TradingView, `data-symbol`). Se não detectar, o usuário confirma/ajusta
manualmente no painel — nunca "adivinha".

## Configuração

`Options` (ícone engrenagem): URL da API (`http://127.0.0.1:8788`) e, se a API
exigir, um token. O token fica apenas em `chrome.storage.local` e é enviado
como `Authorization: Bearer` para a própria API. Nunca é logado nem exposto.

## Permissões

- `sidePanel`, `storage`, `tabs`
- `host_permissions`: apenas `http://127.0.0.1:*` / `http://localhost:*` (API local)
- Content scripts: apenas TradingView, Binance, Exodus.

## Arquivos

| Arquivo | Papel |
|---|---|
| `manifest.json` | MV3, side panel, permissões mínimas |
| `background.js` | SW: config + roteia mensagens → API |
| `content.js` | Detecção de plataforma/ativo/timeframe |
| `sidepanel.html/js/css` | Interface principal (análise ao lado da corretora) |
| `popup.html/js` | Atalho p/ abrir painel |
| `options.html/js/css` | Configuração da API |

## Nota

A API TRACECON deve estar rodando com `MARKET_DATA_MODE=binance` para retornar
dados reais. Caso contrário, a extensão mostra "dados reais indisponíveis" —
nunca valor especulativo.
