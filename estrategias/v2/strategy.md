# V2 — strategy.md (resumo do código)

- Universo dividido 50/50 NORMAL+OTC com assignment persistido (sem troca silenciosa).
- STRICT V2: exige reversão confirmada (RSI deixando extremo + Bollinger + DMI invertendo) SEM
  contradicao estrutural forte (`rejectedStrongTrend`).
- PULLBACK V2: aceita continuacao apos o extremo desde que a banda confirme a rejeicao e o DI novo reaja.
- Ambas usam a mesma janela T-5 e cushion >= 0,25.
- Nenhuma das duas executa: existem como shadow comparativo (decisoes registradas por oportunidade).
