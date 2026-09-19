# V4 — first-10-trades

Este diretório é populado automaticamente por `scripts/rsi-v4-export-first10.mjs`:

```
node scripts/rsi-v4-export-first10.mjs --conn=...            # gera arquivos
node scripts/rsi-v4-export-first10.mjs --conn=... --push     # gera + commit + push
```

- `binary/duration-60s/trade-001.json ... trade-010.json` + `summary.json` + este README.
- `blitz-45s/duration-45s/...` idem (somente se o instrumento for descoberto e executável).
- As operações completas continuam no banco (`iq_v4_export_trades`); o GitHub recebe o pacote congelado.
- Antes de qualquer escrita, o export roda secret scanning; qualquer hit => `BLOCK_GITHUB_EXPORT_SECRET_DETECTED` (exit 2) e nada é gravado.
- Nunca contém: ssid, token, cookie, sessão, credenciais, saldo, ids de conta.

Enquanto a amostra não existir, este arquivo é o placeholder oficial do pacote.
