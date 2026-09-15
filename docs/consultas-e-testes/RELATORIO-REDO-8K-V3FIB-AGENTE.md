# REDO DOS TRADES GUARDADOS COM V3+FIB — Eu × Agente do Sistema

## Objetivo
Reprocessar os trades históricos guardados com a regra congelada **reversion-v3+Fibonacci** e verificar se EU e o AGENTE em produção chegamos ao mesmo resultado (validação de treinamento).

## Massa de dados
- **6.878 trades** carregados do banco (`shadow_trades` com referência causal)
- **3.212 snapshots únicos** (mesmo candle/segmento compartilhado entre trades)
- Reconstrução causal EXATA por (sessão, segmento): filtros do ingest do motor (`ACCEPTED`, `OTC`, `VALID`, mesmo ativo), janela ≤ fechamento do candle, últimas 120 observações

## Minha execução (B = v3+fib congelado)
| Decisão | N |
|---|---|
| BUY | 146 |
| SELL | 24 |
| WAIT | 6.691 |
| skipped (sem snapshot) | 17 |

**Resultado direcional (proxy T+60 registrado de cada trade): W=108 · L=58 · D=0 → WR = 65,1%**

## Execução do agente (mesmos snapshots, via API de produção)
| Etapa | Concordância | Causa dos gaps |
|---|---|---|
| 1ª passada | 98,2% (3.142/3.199) | **bug meu de transmissão** (enviei `{v,t}`; o agente lê `{value,timestamp}` → snapshots vazios) |
| 2ª passada | 99,6% (3.187/3.199) | semântica de janela (`now`): o agente filtra `timestamp <= now`; enviei `now=t0` e a série ia até o fechamento do candle |
| **3ª passada (final)** | **100,0% (3.199/3.199)** | `now = fechamento do candle` — snapshot idêntico dos dois lados |

## Veredito
> **Mesmo snapshot + mesma versão congelada → 100% de concordância BUY/SELL/WAIT.**
> **O agente está corretamente treinado no v3+fib** — reproduz a regra exatamente, evento por evento, em todos os 3.199 snapshots dos 6.878 trades guardados.

Notas:
- Nenhuma otimização; matemática intocada; zero broker side effects.
- O único ponto de atenção restante é de **latência de request** (em live, o `now` do agente é o instante do request, não o fechamento do candle — pode cortar a cauda de ~2s da última observação). Não altera a matemática; anotado para a próxima iteração do coletor.
- Artefatos: `redo8k.json` (resumo completo).
