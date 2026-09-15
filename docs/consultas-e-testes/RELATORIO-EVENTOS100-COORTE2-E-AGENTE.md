# RELATÓRIO — Coorte 2 (100 EVENTOS) + AGENTE DO SISTEMA EM PARALELO · AUD/CAD

## 1. Coleta (protocolo de eventos, coorte 2)

- Run: `fwdE_1789474206841` · início **12:10:06Z** · config hash `869ba2486eb83fc9` · **fechada**
- **100/100 eventos** com T+45 e T+60 resolvidos · `excludedNonLive = 0` (decisões persistidas em T0 antes do futuro) · zero replay/look-ahead
- Checkpoints emitidos: **10 → 20 → 30 → 40 → 50 → 60 → 70 → 80 → 90 → 100** (sem parar, como pedido)
- Stream: AUD/CAD OTC VALID contínuo (253 observações no período, ~17/min)

## 2. Tabela consolidada (minhas contas)

| Estratégia | Horizonte | BUY | SELL | WAIT | W | L | D | U | Dir. N | WR | Wilson 95% | Cobertura |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A (v1+fib) | T+45 | 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 | — | — | 0% |
| A (v1+fib) | T+60 | 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 | — | — | 0% |
| B (v3+fib) | T+45 | 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 | — | — | 0% |
| B (v3+fib) | T+60 | 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 | — | — | 0% |
| C (v2+fib) | T+45 | 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 | — | — | 0% |
| C (v2+fib) | T+60 | 0 | 0 | 100 | 0 | 0 | 0 | 0 | 0 | — | — | 0% |
| D (stochrsi) | T+45 | 3 | 4 | 93 | 4 | 3 | 0 | 0 | 7 | 57,1% | 0.2505–0.8418 | 7% |
| D (stochrsi) | T+60 | 3 | 4 | 93 | 2 | 5 | 0 | 0 | 7 | 28,6% | 0.0822–0.6411 | 7% |

Cobertura baixa novamente (mercado parado; a flat 0.988575 reapareceu no trecho). D operou 7x (única com sinal). A/B/C: 0 sinais na janela.

## 3. Agente do sistema (v3+fib ensinado) — rodando em paralelo

Fonte: tabela `live_decisions` (decisões do app), janela 12:10–12:40Z:

- **6 sinais**: 1 BUY + 5 SELL → **4W / 2L = 66,7%** (Wilson 0.300–0.903)
- Exemplos: BUY 12:13:48 (WIN), SELL 12:22:51 (WIN), SELL 12:23:17 (WIN), SELL 12:27:48 (LOSS), SELL 12:29:16 (WIN), SELL 12:33:46 (LOSS)
- O agente avaliou v3+fib continuamente (há registros `V3FIB_FROZEN_v1` no banco) e também gerou decisões com `probability_source` nulo (quirk de gravação da trilha DECISION do app — anotado abaixo).

## 4. Itens de auditoria abertos (honestidade)

1. **Divergência de séries (em investigação)**: meus eventos tiveram B=0 sinais na janela, enquanto o agente operou 6x. Hipóteses: (a) o agente usa a série contínua do navegador (últimas 120 observações, incluindo histórico anterior ao início da coorte), (b) diferentes pontos de avaliação/cadência, (c) o `probability_source` nulo em parte das decisões gravadas dificulta rastrear a origem. A primeira verificação direta (script de auditoria) selecionou a sessão errada por ordenação de ID — precisa ser refeita escolhendo a sessão ativa pelo maior `observed_at`.
2. **Persistência garantida**: todos os 100 eventos (e os 200 das duas coortes) estão no banco (`fwd_events`) + exportados em CSV/JSON neste repositório — prontos para análise futura.

## 5. Arquivos

- `events100b/events100-summary.json` · `events100b/events100-listing.csv` (coorte 2, 100 eventos individuais)
- `events100-audcad/` (coorte 1, anterior)
- `scripts/index-events.mjs` · `scripts/report-events.mjs` · `scripts/agent-compare.cjs`
