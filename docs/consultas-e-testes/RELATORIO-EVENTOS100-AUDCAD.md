# RELATÓRIO — 100 EVENTOS FORWARD · AUD/CAD · Protocolo de Eventos

Coorte: `fwdE_1789462553091` · início **2026-09-15T08:55:53Z** · config hash `869ba2486eb83fc9` · **fechada** com 100/100 eventos resolvidos (T+45 e T+60).

## Regra de amostragem (fixa, causal, independente de resultado)

Todo candle de 5s com ≥1 observação aceita (AUD/CAD OTC VALID) é um evento candidato, em ordem cronológica. Em T0: entryPrice = última observação do candle; decisões A/B/C/D computadas **somente com dados até o candle** e **persistidas imediatamente**. Um evento só entra se a decisão foi gravada **antes de T+45 existir** (`now − t0 < 45s`). Depois: priceT45 (obs em [T0+45, T0+75]) e priceT60 (obs em [T0+60, T0+90]). Coorte encerra com 100 eventos com T+60 resolvido.

Auditoria: `excludedNonLive = 0` (todas as 100 decisões persistidas antes do futuro). Eventos sem liquidação na janela não entram. Zero look-ahead, zero replay, nenhuma estratégia alterada, zero broker side effects.

## Tabela consolidada

| Estratégia | Horizonte | BUY | SELL | WAIT | W | L | D | U | Directional N | WR | Wilson 95% | Cobertura |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A (v1+fib) | T+45 | 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 | — | — | **0%** |
| A (v1+fib) | T+60 | 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 | — | — | **0%** |
| B (v3+fib) | T+45 | 1 | 0 | 99 | 1 | 0 | 0 | 0 | 1 | 100% | 0.2065–1.0 | 1% |
| B (v3+fib) | T+60 | 1 | 0 | 99 | 1 | 0 | 0 | 0 | 1 | 100% | 0.2065–1.0 | 1% |
| C (v2+fib) | T+45 | 1 | 0 | 99 | 1 | 0 | 0 | 0 | 1 | 100% | 0.2065–1.0 | 1% |
| C (v2+fib) | T+60 | 1 | 0 | 99 | 1 | 0 | 0 | 0 | 1 | 100% | 0.2065–1.0 | 1% |
| D (stochrsi) | T+45 | 7 | 0 | 93 | 2 | 3 | 2 | 0 | 5 | 40,0% | 0.1176–0.7693 | 7% |
| D (stochrsi) | T+60 | 7 | 0 | 93 | 2 | 3 | 2 | 0 | 5 | 40,0% | 0.1176–0.7693 | 7% |

**Resultados idênticos nos dois horizontes** (T+45 e T+60) porque o período foi de baixíssima volatilidade — inclusive 2 eventos com preço estático (DRAW para todos).

## Os 8 eventos com operação (de 100)

| T0 (UTC) | entry | A | B | C | D | t45 | t60 | B/C resultado | D resultado |
|---|---|---|---|---|---|---|---|---|---|
| 09:09:42 | 0.987085 | WAIT | WAIT | WAIT | **BUY** | 0.987205 | 0.987225 | — | WIN/WIN |
| 09:16:46 | 0.987843 | WAIT | WAIT | WAIT | **BUY** | 0.987825 | 0.987655 | — | LOSS/LOSS |
| 09:17:19 | 0.987845 | WAIT | WAIT | WAIT | **BUY** | 0.987620 | 0.987685 | — | LOSS/LOSS |
| 09:19:04 | 0.987715 | WAIT | WAIT | WAIT | **BUY** | 0.987825 | 0.987825 | — | WIN/WIN |
| 09:26:55 | 0.988625 | WAIT | WAIT | WAIT | **BUY** | 0.988385 | 0.988485 | — | LOSS/LOSS |
| **09:27:48** | 0.988418 | WAIT | **BUY** | **BUY** | WAIT | 0.988625 | 0.988575 | **WIN/WIN** | — |
| 09:28:14 | 0.988575 | WAIT | WAIT | WAIT | **BUY** | 0.988575 | 0.988575 | — | DRAW/DRAW |
| 09:29:34 | 0.988575 | WAIT | WAIT | WAIT | **BUY** | 0.988575 | 0.988575 | — | DRAW/DRAW |

Lista completa dos 100 eventos: `events100-listing.csv` (eventId · T0 · entryPrice · A · B · C · D · priceT45 · priceT60 · resultado de cada estratégia nos 2 horizontes; colunas de resultado vazias quando WAIT).

## Leitura

1. **A cobertura é o achado principal**: no período amostrado (janela de 21 min do stream), A/B/C dispararam 0/1/1 vezes e D disparou 7 — as estratégias de Fibonacci são ultraseletivas e o mercado estava lateral (preços repetidos).
2. **B e C acertaram o único sinal** (BUY @09:27:48 → WIN nos dois horizontes). D ficou em 40% (2W/3L/2D) com N direcional = 5.
3. Nenhum veredito estatístico é possível com esta cobertura (IC gigantes) — o protocolo de eventos mede **cobertura/frequência** com honestidade, exatamente como desenhado.
4. Próxima coorte (outra moeda/período) pode ser comparada 1:1 com esta tabela.

Arquivos: `events100-summary.json` · `events100-listing.csv` · `scripts/index-events.mjs` · `scripts/report-events.mjs`.
