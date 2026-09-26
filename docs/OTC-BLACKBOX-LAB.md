# OTC_BLACKBOX_LAB_V1 — coleta inicial

Estado: `WEAK_STRUCTURE` não demonstrado; amostra insuficiente para qualquer conclusão OOS.

## Escopo e isolamento

O laboratório usa somente `list_assets` e `get_candles` dos gateways oficiais Binary e Blitz. Não chama ferramentas de posição, ordem, saldo, depósito ou saque. Não altera V3, Crypto, NORMAL, estatísticas operacionais, stake, armamento ou execução. Execução de ordens: **zero**.

## Alvos escolhidos

Foi escolhido `EUR/USD (OTC)`, asset ID `76`, em cada produto. O critério foi disponibilidade no catálogo e retorno de candles válido; não houve seleção baseada em expectativa de lucro. Os registros brutos estão separados em `data/otc-lab/raw/`.

| Produto | Candles | Intervalo | Labels 300s | UP | DOWN | FLAT |
|---|---:|---|---:|---:|---:|---:|
| Binary | 1.000 | 2026-09-26 12:22:45–13:46:05 UTC | 940 | 479 | 456 | 5 |
| Blitz | 1.000 | 2026-09-26 12:22:50–13:46:10 UTC | 940 | 480 | 455 | 5 |

Os labels usam o primeiro candle cujo fechamento está em ou após `T+300s`; o desalinhamento temporal deve ser reportado em uma análise maior. As janelas são sobrepostas e não são eventos independentes.

## Resultado inicial

No trecho observado, o baseline sempre-UP alcança 50,96% no Binary e 51,06% no Blitz. O baseline da direção anterior alcança 48,62% nos dois. Isso não demonstra edge e não permite afirmar que o algoritmo interno foi descoberto.

A API atual retorna no máximo 1.000 candles por consulta, cerca de 83 minutos a 5s. Não há sete dias de dados nesta coleta; portanto o estudo permanece exploratório e não pode ser classificado como `OOS_EDGE`.

## Próxima etapa segura

Executar coleta prospectiva em baixa frequência, append-only, até obter janela suficiente para treino, validação, teste temporal com embargo de 300s, walk-forward e testes de lookahead. Qualquer modelo deve superar os baselines fora da amostra e continuar separado de toda estatística operacional.

Dados OTC reais observados: **SIM**. Dados sintéticos: **NÃO**. Ordens: **ZERO**. Dinheiro real: **ZERO**.

## Análise inicial reproduzível

O script `scripts/otc-lab-analyze.mjs` calcula um split cronológico 60/20/20, embargo de 300s, entropia, transições, runs e autocorrelação de retornos. Nos dois produtos, a entropia direcional foi ~0,9995 bits e a autocorrelação de retorno no lag 1 ficou próxima de zero (Binary -0,0033; Blitz -0,0023). O teste cego de 188 labels terminou com 72 UP e 115 DOWN: sempre-DOWN teria 61,17% nesse trecho, enquanto sempre-UP teria 38,30%. Isso é uma mudança de regime/distribuição, não evidência de modelo preditivo; os parâmetros não foram escolhidos olhando esse trecho.

Os runs longos (máximo 102) são consequência provável da sobreposição dos rótulos em passos de 5s e não podem ser tratados como 102 eventos independentes. É necessário aumentar a janela, usar bootstrap em blocos e coletar prospectivamente antes de testar hipóteses ou chamar o estado de `OOS_EDGE`.

### Correção metodológica da primeira análise

O baseline de direção anterior calculado nos 940 labels sobrepostos chegou a cerca de 91%, mas esse número é um artefato: labels separados por 5s compartilham quase todo o mesmo horizonte futuro. Ao reamostrar a cada 300s, restam apenas 16 observações aproximadamente não sobrepostas; o baseline sempre-UP foi 50,0% no Binary e 56,25% no Blitz, e o trecho final ficou em 50,0% em ambos. A análise correta, portanto, não mostra edge nesta amostra curta.

### Técnicas adicionais

Markov de ordens 1–5 foi ajustado somente no primeiro trecho e avaliado no último trecho temporal. O resultado in-sample chegou a ~56% no Markov-5, mas no teste temporal caiu para 51% (Binary) e 53% (Blitz), sem evidência robusta acima do acaso. Os maiores picos espectrais ocorreram em períodos de aproximadamente 3–6 amostras de 5s, mas não foram estáveis nem suficientes para declarar periodicidade. Regimes simples de volatilidade também oscilaram perto de 50%.

Conclusão atual: aumentar a complexidade encontra padrões descritivos e overfitting, não um algoritmo confiável. A próxima evidência necessária é coleta prospectiva mais longa, com parâmetros congelados antes do teste cego.
