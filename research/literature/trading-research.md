# Base de conhecimento: pesquisa quantitativa TraceCon

Esta nota registra princípios, não uma promessa de estratégia. Estudos de ações,
futuros ou dados proprietários não são assumidos como transferíveis para FX OTC.

| Fonte | Ideia e mercado | Limitação | Teste permitido no TraceCon |
| --- | --- | --- | --- |
| Bailey et al., *Probability of Backtest Overfitting* / 2014 | Muitas configurações podem produzir desempenho histórico espúrio; o risco aumenta com o catálogo de testes. | Não transforma uma simulação em evidência de execução. | Registrar todas as hipóteses/variantes, manter holdout bloqueado e nunca selecionar pelo maior resultado histórico. [SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2308659) |
| Bailey & López de Prado, *Deflated Sharpe Ratio* | Ajusta a interpretação do Sharpe pelo número de tentativas, não-normalidade e tamanho amostral. | Requer retornos e definição precisa do universo de trials; não reportar DSR quando esses insumos não forem sólidos. | Marcar DSR como indisponível quando o estudo não mantém um catálogo/retornos adequados; não substituir por um número inventado. [paper](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf) |
| Cont, Kukanov & Stoikov, *The Price Impact of Order Book Events* | Em ações NYSE, mudanças curtas de preço se relacionam ao desequilíbrio de eventos no melhor bid/ask e à profundidade. | É evidência de livro de ordens de ações, não de Yahoo OHLC nem de FX OTC fragmentado. | Somente testar OFI real quando houver eventos L1/L2 timestamped; rotular OHLC-only como `NOT_AVAILABLE`. [arXiv](https://arxiv.org/abs/1011.6402) |
| Evans & Lyons, *Exchange Rate Fundamentals and Order Flow* | Fluxos de transação podem agregar informação no câmbio e relacionar-se a fundamentos. | Usa dados de fluxos de clientes; FX é descentralizado e um feed não é “o” mercado. | Guardar provider, sessão e origem de quote; não inferir fluxo de ordens a partir de candles. [NBER](https://www.nber.org/system/files/working_papers/w13151/w13151.pdf) |

## Metodologia adotada

1. A entrada usa apenas candle fechado e 20 barras antecedentes contínuas; o
   rótulo é liberado depois do fechamento do horizonte. Isto implementa uma
   simulação prequential, não uma recalibração retroativa.
2. O seletor compara somente três filtros pré-registrados e somente dados com
   rótulo já liberado. A cada 100 trades acionáveis pode trocar de versão; no
   trade 801 congela estratégia, features e versões para o holdout.
3. Há embargo por par igual ao horizonte, impedindo sobreposição de outcomes na
   mesma série. O `effective N` reportado é válido apenas sob essa independência
   intra-par; correlação entre pares é uma limitação declarada.
4. Custos são uma proxy explícita de Forex quando não há spread histórico. Net
   EV não é interpretado como executável sem bid/ask, slippage e latência reais.
5. 30s e 45s requerem ticks, quotes ou barras nativas de segundos. OHLC de 1m
   não contém o caminho intraminuto; interpolá-lo produziria resultados falsos.

## Limites atuais e próxima coleta válida

O provider Yahoo atual é somente OHLC fechado de um minuto. Assim, o sistema
testa price action, tendência, volatilidade e contexto de sessão em 60–300s;
ele não testa microprice, book imbalance, depth, quote velocity, spread real,
trade arrival intensity ou verdadeiro OFI. Uma fase futura só poderá adicionar
essas hipóteses após integrar um feed read-only que retenha timestamps,
bid/ask e, para OFI/L2, eventos de livro de ordens auditáveis.
