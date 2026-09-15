# IQOPTION_AUTH_REQUIRED — Validação Externa 10h (EUR/USD Binary)

**Status**: BLOQUEIO EXTERNO COMPROVADO — a aquisição de Historical Quotes exige sessão autenticada IQ Option + extensão TraceCon, ausentes no ambiente.
**Data**: 2026-09-15 · **Dados fabricados**: 0 (nenhum tick sintético/mock/feed externo será usado)
**Caminho legítimo localizado**: extensão TraceCon (`C:\tracecom-recovered\src\dist-extension`) — bridge MAIN-world em iqoption.com que captura frames de mercado da PRÓPRIA página (somente leitura; comentário do código: "Inbound market frames only; no auth/session data"). Nenhum bypass de autenticação é necessário nem permitido.

## URL/página exata (fonte oficial)
- **Cotações Históricas (tick-by-tick, últimos 7 dias, somente contratos de Opção, exclui últimos 30 min)**: **https://iqoption.com/pt/quotes**
- Alternativa: Histórico de Negociação → clicar no ativo (EUR/USD) → Cotações Históricas.
- Doc: https://blog.iqoption.com/pt/como-verificar-negociacoes-na-iq-option-e-por-que/ (mid = (bid+ask)·0,5)

## Ação humana mínima necessária (4 passos, ~2 min)
1. Chrome → `chrome://extensions` → ativar **Modo do desenvolvedor** → **Carregar sem compactação** → selecionar `C:\tracecom-recovered\src\dist-extension`.
2. Fazer login normal na IQ Option nesse mesmo Chrome (não compartilhar senha; nada de credenciais comigo).
3. Abrir **https://iqoption.com/pt/quotes**, selecionar **EUR/USD** (contrato de **Opção/Binary — NÃO OTC**) e um bloco de **~10h contínuas** dentro dos últimos 7 dias, **excluindo os últimos 30 minutos**.
4. Avisar "pronto" para eu executar a coleta + análise.

## O que já foi validado (evidências)
- App IQ Option desktop **rodando** (PID 18276) mas **sem porta de debug/API local** (netstat: 0 listeners; cmdline sem flags) → inacessível programaticamente sem contornar proteções (proibido).
- Extensão TraceCon **íntegra recuperada** (`dist-extension/`: manifest MV3, host_permissions `iqoption.com`, `iq-page-bridge.js` MAIN-world, hooks WebSocket/XHR, normaliza `candle-generated`/ticks) — **NÃO instalada** em nenhum perfil Chrome/Edge (varredura completa de `Extensions/`: 0 correspondências TRACE).
- **Nenhuma sessão/credencial IQ** no ambiente (tabela `provider_secrets` sem provedor IQ; nenhum ssid/token no repo/env).
- **Nenhuma aba iqoption.com aberta** (títulos de janela verificados).
- DB de produção contém apenas observações de **visão** (VISION_WEB, OTC) — **nada será substituído ou mesclado**.
- Namespace experimental **já criado** no Supabase: `iqopt_datasets`, `iqopt_raw_ticks`, `iqopt_candles_5s`, `iqopt_decisions` (isolado do GroundTruth existente; `source=IQ_OPTION`, `contract_type`, `otc`, `bid`, `ask`, `mid`, `raw_price`, `source_timestamp`, `ingested_at`, `provenance`, `dataset_id`).

## Próximo processo (executa imediatamente após autenticação)
1. `node iqopt-collector.cjs IQOPTION_EURUSD_BINARY_10H` — coletor read-only da página /quotes (gerado no momento conforme o protocolo real observado na página; grava RAW antes de qualquer transformação em `iqopt_raw_ticks`).
2. `node iqopt-pipeline.cjs IQOPTION_EURUSD_BINARY_10H` — candles 5s exatos (sem interpolação; gaps marcados) → features causais idênticas ao Gauntlet → **finalistas CONGELADOS** (hash `2a49fb3e…`, sem retreinar/alteração) → liquidação T+60 → relatório TOTAL + INDEPENDENT WINDOWS + ranking + comparação com HOLD anterior.
3. OTC: verificar programaticamente se **EUR/USD OTC** aparece na página de cotações históricas; se sim → `IQOPTION_EURUSD_OTC_10H` (resultados **separados**, nunca combinados); se não → **OTC_HISTORICAL_DATA_NOT_AVAILABLE** (não bloqueia o Binary).
4. Critic independente: amostras aleatórias de ticks/candles/entry/settlement/WIN-LOSS + confirmação de ausência de informação futura + confirmação de proveniência IQ_OPTION.

## Estratégias congeladas que serão aplicadas (sem ajustes)
`and(struct_f,macd_r)` · `and(fib_ctx,stoch_r_30)` · `gate(struct_f|expansion>1.3)` · `gate(struct_f|bullDiv)` + 18 referências (produção + baselines + componentes) do `finalists-manifest.json`.
