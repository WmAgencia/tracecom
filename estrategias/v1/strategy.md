# V1 — strategy.md (resumo do código)

- Detector: RSI Wilder 14 em extremos (<=30/>=70).
- STRICT: exige confirmação de reversão (RSI saindo do extremo + Bollinger + DMI coerente + sem
  continuação forte contra).
- PULLBACK: após o extremo, entra no pullback quando a banda é rejeitada e o DI novo reage.
- Janela de entrada: 5s antes do cutoff de turb (T-5), cutoff T-30s.
- Cushion/projeção determinística introduzida nesta família (depois herdada por V3/V4).
- Sem memória de episódio (V3.1 introduziria o conceito).
