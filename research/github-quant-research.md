# TraceCon: pesquisa de referências quantitativas para TRACE_1M

_Auditoria em 11 de setembro de 2026. Estrelas e atividade são uma fotografia
da API pública do GitHub, não uma medida de adequação ao produto._

## Decisão de arquitetura

O TraceCon continua com um core TypeScript pequeno, **somente análise e shadow
validation**. Nenhuma biblioteca abaixo é incorporada nesta fase. A prioridade
é preservar as fronteiras já auditáveis: timestamps de candle fechado, decisão
sem execução, custos explícitos, split prequential 800/200 e production gate
fail-closed. Conceitos são implementados nativamente apenas quando existe dado
compatível; OHLC de 1 minuto não pode ser apresentado como bid/ask, tick ou
order book.

| Referência | Fotografia pública | Classe | O que aproveitar | Não aplicar / risco | Ação TraceCon / benefício 1m |
| --- | --- | --- | --- | --- | --- |
| [NautilusTrader](https://github.com/nautechsystems/nautilus_trader) | 28.8k estrelas; Rust; LGPL-3.0; ativo | CRITICAL_REFERENCE | modelo orientado a eventos, replay determinístico, relógios e modelo normalizado de quote/trade/bar | é uma plataforma completa e LGPL; não copiar nem embutir o motor | manter eventos com timestamp de origem/recebimento e adapters normalizados; **alto**, sobretudo quando houver quotes reais |
| [vectorbt](https://github.com/polakowo/vectorbt) | 9.1k; Python; licença não declarada pela API; atividade recente | HIGH_VALUE | exploração vetorizada e comparações em lote | pesquisa massiva aumenta multiple testing e a licença precisa ser confirmada antes de uso | inspirar matrizes pre-registradas, nunca promover parâmetros pelo holdout; **médio** |
| [hftbacktest](https://github.com/nkaz001/hftbacktest) | 4.7k; Rust; MIT | HIGH_VALUE | replay de tick, latência, filas e modelos de fill | exemplos são principalmente cripto; L2/L3 não existe no Yahoo OHLC Forex | usar conceitos para um futuro adapter de quote/tick, sem inferir OFI de candles; **alto com L1/L2**, nulo na fonte atual |
| [mlfinlab](https://github.com/hudson-and-thames/mlfinlab) | 4.9k; Python; licença não declarada pela API; última atividade pública 2023 | RESEARCH_ONLY | meta-labeling, purging, embargo e sample uniqueness | pacote/licença não é dependência desta aplicação; risco de leakage se labels sobrepostos forem tratados como independentes | implementar somente conceitos descritos na literatura, com embargo temporal e effective N; **alto para validação**, não promessa de alpha |
| [backtesting.py](https://github.com/kernc/backtesting.py) | 9.0k; Python; AGPL-3.0 | USEFUL | baseline independente, métricas e verificações simples | AGPL impede incorporar código ao produto fechado; bar-based fills não resolvem microestrutura 1m | usar apenas como comparação conceitual/documental; **baixo a médio** |
| [backtrader](https://github.com/mementum/backtrader) | 23.2k; Python; GPL-3.0; atividade 2024 | RESEARCH_ONLY | commissions, slippage, calendars e analyzers | GPL e menor atividade; não integrar/copy | preservar custo/slippage/calenário como conceitos nativos; **médio** |
| [FinRL](https://github.com/AI4Finance-Foundation/FinRL) | 16.3k; MIT | RESEARCH_ONLY | construção de estado e disciplina de reward/environment | RL é inadequado sem muito dado granular, validação purged e um simulador de execução defensável | não introduzir RL nesta fase; **baixo hoje** |
| [Freqtrade](https://github.com/freqtrade/freqtrade) | 54.3k; Python; GPL-3.0; ativo | USEFUL | organização de backtest, proteções e detecção de lookahead | é crypto-first e GPL; não é fonte de microestrutura/Forex | adotar testes de regressão/lookahead por comportamento, sem dependência; **médio para engenharia** |

## Guardrails de pesquisa TRACE_1M

1. **Target**: entrada planejada em `t`; uma direção só vence se o retorno após
   60 segundos exceder a dead-zone e todos os custos conhecidos. Empate e dado
   ausente nunca viram vitória.
2. **Proveniência**: features devem existir em ou antes de `t`; outcome só é
   liberado depois de `t + 60s`. O provider atual fornece candle fechado de 1m;
   portanto bid, ask, spread dinâmico, tick imbalance, OFI e microprice ficam
   `NOT_AVAILABLE`, não sintéticos.
3. **Seleção**: adaptações ocorrem apenas nos 800 sinais prequential; antes do
   sinal 801, modelo, calibração, features e filtro são congelados. O holdout
   não pode gerar uma nova regra.
4. **Produção**: o gate de 70% mantém `WAIT` até haver probabilidade calibrada,
   bucket OOS e limite inferior de IC de 95%, EV líquido, qualidade, frescor e
   risco aprovados. Um score bruto alto não é evidência.

## Resultado deste ciclo

O estudo já versionado de 1m/Yahoo tem 1.000 decisões avaliadas em split
800/200; o holdout tem EV líquido negativo. A conclusão é **NO_ROBUST_70_1M_EDGE
FOUND** para este provider/modelo, não uma oportunidade. A próxima melhoria
empírica depende de dados de quotes/ticks Forex com permissão e qualidade
verificável, não de adicionar modelos ou bibliotecas.
