# Pasta de Consultas e Testes

> **Esta pasta é destinada a consulta e testes.** Não faz parte do código de produção.

## Conteúdo

- **Relatórios de sessões** de análise e validação do experimento shadow (meta 10.000 trades).
- **Resultados das estratégias testadas** (v1–v6, snapback, bollinger-rsi, macd-rsi, dual-rsi, pullback).
- **Scripts** de monitoramento e análise usados durante as sessões (Node + PostgreSQL).
- **Exportações de dados** (CSV) dos trades do experimento para auditoria independente.

## Como usar

- Consulte `RELATORIO-SESSAO-2026-09-14.md` para o histórico completo da sessão.
- Consulte `V6-VALIDACAO-EURNZD.md` para o resultado da validação forward do `shadow-reversion-v6`.
- Os scripts em `scripts/` dependem de `DATABASE_URL` (Postgres) e do Node 22+; servem apenas para reproduzir as análises.

## Aviso

- Todos os números são de experimentos **SHADOW (paper)**. **Nenhuma automação de corretora** é utilizada.
- Regra de integridade: **nenhuma estratégia é promovida a produção** com base nestes números; amostras não são infladas.
- Dados de mercado vêm exclusivamente de observações causais persistidas (sem fabricação).
