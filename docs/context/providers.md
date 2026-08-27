# TRACECON — Provedores de Contexto (Notícias / Web / Macro)

Regra: nenhum item é inventado; sem fonte disponível → `PROVIDER_NOT_CONFIGURED`.
Timestamps, fonte e credibilidade acompanham cada item.

---

## Free Crypto News API (cryptocurrency.cv) — INTEGRADO

**Status: ✅ Verificado (keyless, free tier).**

| Item | Detalhe |
|---|---|
| Fonte | `https://cryptocurrency.cv` (agregador open-source, MIT, 200+ fontes) |
| Auth | Nenhuma (keyless) |
| Endpoints usados | `GET /api/news?category=<asset>&lang=en` (verificado) |
| Endpoints pagos | `/breaking` (402 sem plano), níveis avançados — NÃO usados |
| Campos | título, link, pubDate, fonte, credibilidade (0..1), reputação, categoria |
| Verificação | Retornou artigos reais (Bitcoin.com News, Stacker News) com timestamps e cred 0.6 |
| Limitações | Agregador — qualidade varia por categoria; exigir `search?q=` para maior precisão em consultas específicas. |
| Cache | `NewsService` (TTL 30s) evita chamada a cada candle |

**Bias de sentimento:** derivado por classificador léxico (palavras-chave e
credibilidade) — NÃO é afirmar causalidade de preço; é um indicador explícito
e auditável. Se não houver itens, retorna `null`.

---

## CryptoCompare / CoinDesk Data API — NÃO INTEGRADO

**Status: ⏳ Pendente (requer `CRYPTOCOMPARE_API_KEY`).** Documentado como
provedor robusto (150+ fontes, WebSocket, histórico). Sem credencial →
`PROVIDER_NOT_CONFIGURED`. A infra (`NewsProvider`) já o comporta.

---

## Macro / Calendário econômico — NÃO INTEGRADO (TODO)

Sem provedor definido. Para a Tracecon é preciso verificar fonte real
(ex.: economia/causal, fornecedores de calendário econômico) antes de assumir
endpoint. Deixado como TODO.
