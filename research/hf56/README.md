# HF56 — pesquisa de reversão PUT 15 minutos (NÃO APROVADO PARA REAL)

## Comando imediatamente executável
```bash
node research/hf56/backtest.mjs
```

Esse script roda **offline**, sobre os CSVs existentes, sem chave da IQ, sem conexão, sem ordens, sem martingale. Não altera o bot, ARM ou AUTO. Veja o placar por treino, validação e teste e o limite de 10 sinais simultâneos por ativo.

## Regra congelada
Cinco índices US 100, US 2000, US 30, US 500, JP 225; remover UK 100 foi uma escolha retrospectiva em dados de treino, já examinados. Candle fechado de 60 segundos, se `close[i]>close[i-5]`, previsão **PUT**; entrada hipotética no `open[i+1]`; liquidação hipotética no `close[i+15]`. Vencimento de 900 segundos. Conta **SHADOW ONLY**; nenhuma ordem será enviada.

## Evidência histórica exploratória
Na amostra dos **seis** ativos originais (incluindo UK 100), sem limitar posições:
- treino 757 wins / 507 losses (59,89% em 1.264);
- validação 389 / 287 (57,54% em 676);
- teste 342 / 183 (65,14% em 525);
- frequência de ~146 sinais/h no teste histórico.
As divisões de validação/teste cobrem somente 28/09/2026. No trecho de 27/09 o PUT registrou 36/144, **25% WR**. Esses resultados **não** validam ganho em produção.

Cinco ativos selecionados pelo treino:
- sem limite: treino 653/1059=61,66%, validação 333/559=59,57%, teste 286/429=66,67%;
- **limite de dez simultâneas/ativo**: treino 597/964=61,93%; validação 290/500=58%; teste 261/397=65,74%, ~113/h no trecho final.

Os 12 ETFs fora do catálogo de execução deram 54,38% no teste final com mesma regra PUT, sem filtro de ativos. Forte risco de regime e correlação.

## Não operar com dinheiro real ainda
Limite de dez por ativo é uma restrição de simulação, **não** recomendação de exposição; 5 ativos x 10 entradas são 50 posições simultâneas de alto risco.

Pré-requisitos de qualquer teste prospectivo: feed de candles fechado ponto-no-tempo; catálogo Blitz com vencimento 900s realmente disponível no instante; payout real; ordem no broker PRÁTICA com strike e vencimento comprovados; ledger imutável de sinais, ordens e liquidações. Treinar de novo invalida o teste prospectivo.

Critério de pesquisa proposto: >=900 settlements novos, >=10 dias distintos, limite inferior de IC por bootstrap de dias >56%, EV líquido >0 e >=50 sinais por meia hora na maioria das janelas elegíveis. Mesmo passando, exigir testes de execução PRACTICE; **nunca liberar AUTO/REAL automaticamente**.

Arquivos de pesquisa avançada separados disponíveis no chat: `hf56.mjs` (shadow somente leitura e score) e documentação detalhada. Este PR mantém tudo isolado da operação atual.
