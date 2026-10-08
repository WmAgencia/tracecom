# HF56_PUT_R5_H15_V1 — Estratégia de reversão de 15 minutos

**STATUS: SOMENTE PESQUISA / SHADOW. NÃO APROVADA PARA CONTA REAL.**
Este módulo não coloca ordens, não troca conta, não arma AUTO, não aumenta stake e não altera o runtime operacional.
Implementação: ./hf56.mjs · avaliação histórica anterior: ./backtest.mjs · testes: ./hf56.test.mjs.

## 1. Regra exata

A cada candle de UM MINUTO já fechado e recebido do produto IQ binary-options:

1. Reunir 26 candles cronologicamente consecutivos, incluindo o candle atual.
2. Definir P_atual = close[i] e P_5min = close[i-5]. Nenhum candle futuro é usado para produzir o sinal.
3. Se P_atual > P_5min: produzir apenas a indicação **PUT / DOWN** (previsão de queda). Se igual ou menor: **WAIT**. Não existe CALL nesta versão.
4. Consultar o catálogo atual do produto de referência IQ blitz-options para o ativo. Registrar sinal somente quando is_open=true, o vencimento de 900s está listado e profit_percent >= 89.
5. Se houver menos de dez previsões ainda não vencidas *nesse mesmo ativo*, aceitar o sinal; caso contrário, WAIT. O limite é por ativo, não global.
6. Definir instante teórico de entrada como o início do PRIMEIRO candle depois do candle de decisão e vencimento 900 segundos após esse início.
7. Regra de backtest: preço de entrada = open[i+1], preço no vencimento = close[i+15]. Para PUT: se saída < entrada, WIN; se saída > entrada, LOSS; se igual, EMPATE (não contabilizado como win ou loss). O índice i+15 corresponde ao 15º candle de um minuto após o sinal, isto é, fechamento 15 minutos depois do instante teórico de entrada.

**Exemplo de relógio:** candle terminado às 10:05; comparar seu fechamento com o candle terminado às 10:00. Se houve alta, previsão PUT a partir das 10:05:00, expiração às 10:20:00. O backtest presume entrada exatamente na abertura das 10:05; o sistema SHADOW não reivindica que essa ordem hipotética pudesse ser executada a esse preço.

Ativos congelados nesta versão, com IDs IQ observados no catálogo do estudo:

| Índice | Asset ID |
| --- | ---: |
| US 100 | 1471 |
| US 2000 | 1473 |
| US 30 | 1472 |
| US 500 | 1470 |
| JP 225 | 1476 |

**UK 100 foi excluído após analisar o treinamento; trata-se de seleção exploratória, não de prova independente.** Mudanças nos ativos/limiares só com uma nova versão e um novo experimento prospectivo.

## 2. Frequência e limite de posições

O sistema toma até uma decisão por minuto por ativo, mas **só gera sinal se houver alta em relação a cinco minutos atrás** e se as outras verificações permitirem. O máximo é 10 previsões simultâneas de 15 minutos por ativo, ou 50 nos cinco ativos; é um limite de pesquisa, **não autorização de risco real**.

No último segmento histórico, sob esse teto, houve **397 sinais, 261 wins e 136 losses = 65,74%**, ~113 sinais/hora (~56 sinais/meia hora). Isso NÃO implica 56% em cada janela de 30 minutos nem garante essa frequência daqui para a frente.

## 3. Dados, métodos e limitações

- Fonte: diagnostic-results/data/iq-real/binary-options/{US-100,US-2000,US-30,US-500,JP-225}_60s.csv.
- Cada série tem pouco mais de 1.000 candles únicos, apesar de milhares de linhas repetidas.
- Candles idênticos no mesmo timestamp são desduplicados; timestamps com candles conflitantes são excluídos.
- Exigir 25 candles contínuos anteriores e janela completa de 15 minutos de resultado, sem gaps. Divisões cronológicas POR ATIVO: 50% treino, 25% validação, 25% teste, com embargo de 15 candles nas bordas.
- Entradas são proxies OHLC. Não existem ordens IQ reais, preço de strike confirmado, latência real do broker, payouts de execução, nem comprovante de liquidação.
- O segmento final reproduz essencialmente um único dia, 28/09/2026. Alguns índices americanos são altamente correlacionados. O segmento de 27/09 registrou 36 wins em 144 PUTs nos seis índices (25%).
- A mesma regra nos outros 12 ETFs históricos marcou 54,38% no teste final, embora esses ETFs não estivessem disponíveis como ativos executáveis no catálogo utilizado. Esses resultados impedem supor universalidade.

## 4. Resultados históricos da seleção de cinco ativos

| Período | Sinais aceitos com no máximo 10 simultâneos/ativo | Wins | Losses | WR |
| --- | ---: | ---: | ---: | ---: |
| Treinamento | 964 | 597 | 367 | 61,93% |
| Validação | 500 | 290 | 210 | 58,00% |
| Teste | 397 | 261 | 136 | 65,74% |

São sinais correlacionados e parcialmente sobrepostos; o tamanho efetivo da amostra é menor do que a contagem de sinais.

## 5. Comandos (Node 22+)

Executar na raiz do repositório. Necessário apenas Node para os dois primeiros comandos:

~~~powershell
node research/hf56/hf56.mjs backtest
node --test research/hf56/hf56.test.mjs
node research/hf56/hf56.mjs score
~~~

Para acompanhar candles prospectivos da IQ em SHADOW, é necessário um token de LEITURA do MCP já provisionado localmente; nunca escrevê-lo no repositório:

~~~powershell
$env:IQ_MCP_TOKEN = "INSERIR_TOKEN_LOCALMENTE"
$env:HF56_MAX_CYCLES = "1"
node research/hf56/hf56.mjs shadow
~~~

Para execução contínua, remover HF56_MAX_CYCLES do ambiente. O observador faz consultas de leitura; nunca envia ordens PRACTICE nem REAL. O ledger local padrão é research/hf56/hf56-prospective.jsonl (append-only). Excluir ledger e checkpoint dos commits. O campo lagMs mede quanto tempo após o instante hipotético de entrada o sinal foi registrado — esse atraso NÃO é magicamente eliminado.

## 6. Critérios para avançar

O placar SHADOW expõe volume de sinais, WIN/LOSS, datas distintas, evolução por meia hora, EV teórico condicionado ao payout, e limite inferior de bootstrap por dias. O booleano historicalResearchThresholdMet exige simultaneamente >=900 previsões liquidadas, >=10 dias, >=150 janelas de 15 minutos, limite inferior de 95% do bootstrap de dias >56%, e EV teórico >0.

**Passar nesse critério NÃO ativa capital real e não prova WR executável.** Antes de qualquer decisão de operação real são obrigatórios resultados registrados efetivamente no broker em conta PRACTICE, consistência do vencimento e preço de abertura, testes de payout/latência, limites de exposição mais conservadores, e revalidação estatística sem modificar parâmetros com base nos dados prospectivos.

O experimento é propositalmente separado do bot de produção. Nem este PR nem merge posterior habilitam ARM/AUTO.
