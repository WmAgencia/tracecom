# V2 — strategy.md (resumo do código)

> **ESTRATÉGIA CENTRAL** (designação do operador, 2026-09-20). Spec canônica completa em `SPEC.md`.
> Regra do operador: candidatos somente a partir de RSI <=25 / >=75 (detecção); a entrada é autorizada apenas pela V2 (confirmação + revalidação causal).

- Universo dividido 50/50 NORMAL+OTC com assignment persistido (sem troca silenciosa).
- STRICT V2: exige reversão confirmada (RSI deixando extremo + Bollinger + DMI invertendo) SEM
  contradicao estrutural forte (`rejectedStrongTrend`).
- PULLBACK V2: aceita continuacao apos o extremo desde que a banda confirme a rejeicao e o DI novo reaja.
- Ambas usam a mesma janela T-5 e cushion >= 0,25.
- Executam ao vivo pela infraestrutura atual (relay/rsi-agents-v2-live.mjs): DETECT -> CANDIDATE -> ACTIVE WATCH -> PRIORITY_FINAL_WATCH -> revalidacao causal -> ENTER/CANCEL; 1 ordem por vez; teto R$2.
