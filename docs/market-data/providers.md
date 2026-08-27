# TRACECON — Provedores de Market Data

> Este documento registra a pesquisa técnica dos provedores de dados usados
> pela TRACECON. **Regra:** nenhum dado é inventado; nenhum endpoint é
> assumido sem verificação. Uma tabela não significa que a integração existe —
> ver a coluna "Status da integração".

Regra de segurança/operacional:

- Toda credencial (API key) permanece no servidor.
- Sem provedor configurado → a camada de mercado retorna
  `PROVIDER_NOT_CONFIGURED` (equivalente a `DATA_UNAVAILABLE`), nunca dados
  falsos.

---

## Binance (crypto) — INTEGRADO

**Status da integração: ✅ Verificado e funcional (REST). WebSocket em progresso.**

| Item | Detalhe |
|---|---|
| Mercados | Spot (também Futures/Margem em rotas separadas). |
| Autenticação | REST público não requer chave para klines/klines/ticker/book/trades. |
| REST | `https://api.binance.com/api/v3/*` |
| WEB | `wss://stream.binance.com:9443/stream?streams=<s>@kline_<i>/...` (combinado sem auth) |
| Historical candles | `GET /api/v3/klines?symbol=&interval=&startTime=&endTime=&limit=` |
| Realtime candles | `kline_<interval>` (push, ~2s; 1s para `1s`) |
| Trades | `GET /api/v3/trades`, `GET /api/v3/aggTrades`; WS `@trade` |
| Order book | `GET /api/v3/depth?symbol=&limit=`; WS `@depth`. Não usado para liquidez v2 nesta etapa. |
| Volume | Incluído no kline (base asset `v`, quote `V`). |
| Funding | Apenas **Futures**, `GET /fapi/v1/premiumIndex` (spot não tem). |
| Open Interest | Apenas **Futures**, `GET /fapi/v1/openInterest`. |
| Rate limits | Klines weight 2 (≤500) / 5 (≤1000); limite IP 6000/min (spot). WS streams não consomem weight. |
| Preço | Gratuito. |
| Timeframes | `1s 1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w 1M`. |
| Limitações | Rotas Futures (`/fapi`) exigem contexto; funding/OI disponíveis só em spot? Não. Não tratamos ordens. Latência WS ~subs-second. |

### Verificação realizada (22/ago/2026)

`GET /api/v3/klines?symbol=BTCUSDT&interval=1m&limit=3` retornou 3 candles reais
(BTC ≈ US$78.4k) com OHLCV válidos e timestamps em ms (UTC). Endpoint confirmado.

**Formato bruto do kline (rest/ws):** array `[0]=openTime(ms),
[1]=open, [2]=high, [3]=low, [4]=close, [5]=volume(base),
[6]=closeTime(ms), [7]=quoteAssetVolume, [8]=trades, ...]` (REST).
No WS, o payload vem sob `k`: `{ t,o,h,l,c,v,T,x(i=closed), ... }`.

---

## Alpaca (ações / crypto / forex) — NÃO INTEGRADO

**Status da integração: ⏳ Pendente — requer `ALPACA_API_KEY` / `ALPACA_SECRET`.**

| Item | Detalhe |
|---|---|
| Mercados | US equities (consolidado/IEX), crypto, (opções). |
| Autenticação | `APCA-API-KEY-ID` + `APCA-API-SECRET-KEY` (obrigatório). |
| REST | `https://data.alpaca.markets/v2/*` |
| WebSocket | `wss://stream.data.alpaca.markets/v2/{iex|sip|crypto}` (auth via `auth` frame). |
| Historical candles | `GET /v2/stocks/{symbol}/bars` (feed `iex`/`sip`); via `sip` exige plano. |
| Trades | `GET /v2/stocks/{symbol}/trades`; WS `t` |
| Order book | Não exposto em nível de book para equities (quotes `b`/`a`). |
| Volume | Incluído nas barras. |
| Funding / OI | Não aplicável a ações; crypto tem funding em rota própria (exige plano). |
| Rate limits | Free tier: 1 sub WS; 1000 req/min em "Unlimited". Sip = pago. |
| Preço | Free (IEX/delayed). Sip/consolidado = pago. |
| Limitações | Dados IEX são parciais (sem volume consolidado). Forex via Alpaca é limitado; para forex usar outro provedor. |

**Decisão:** integrar depois de o usuário informar credencial. A infraestrutura
(interface de provider) já comporta `alpaca` sem alterar o resto do sistema.

---

## Forex / Ações / Índices — pendente de provedor

- Forex: precisa de provedor real (ex.: TwelveData/FCS/Sifting). Nenhum
  endpoint assumido; deixado como TODO até escolher/validar.
- Ações: Alpaca (acima) é o candidato, pendente de chave.
- Índices: sem provedor definido nesta etapa (TODO).

---

## Resumo da escolha

| Mercado | Provedor | Status |
|---|---|---|
| Crypto (BTC, ETH, SOL, fiat-quotes) | **Binance** | ✅ REST real; WS em andamento |
| Ações (US) | Alpaca | ⏳ pendente de chave |
| Forex | — | ⏳ TODO (pesquisar/validar) |
| Índices | — | ⏳ TODO |

---

## Como adicionar um provedor

1. Verificar documentação oficial e testar um endpoint real (não assumir).
2. Implementar `MarketDataProvider` (interface em `src/market/provider.ts`).
3. Normalizar para o modelo canônico (`src/market/model.ts`).
4. Registrar em `src/market/registry.ts` com um `MarketDataMode`.
5. Documentar aqui (tabela + verificação) e adicionar testes.
