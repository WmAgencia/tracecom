# V2 runs — amostras da rodada v2-live (Strategy Core V2 + infraestrutura atual)

- Cada run vive em `runs/<run-id>/first-10-trades/` com `trade-001..010.json`, `summary.json`, `README.md`.
- Populado por `scripts/rsi-v4-export-first10.mjs` filtrando `strategy_version='v2-live'` (tabelas `iq_v4_export_*`).
- As operações completas ficam no banco (`iq_rsi_opportunities_v2live`); o GitHub recebe o pacote congelado.
- Sanitização obrigatória antes de escrever: `BLOCK_GITHUB_EXPORT_SECRET_DETECTED` aborta o export.
- Não misturar com trades históricos da V2 (rodada anterior).
