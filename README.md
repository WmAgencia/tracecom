# TraceCom

TraceCom é um sistema de monitoramento, análise e execução controlada de operações binárias da IQ Option. Ele não é uma corretora e não custodia recursos: mantém a conta conectada, recebe dados de mercado, documenta cada decisão e só pode enviar uma ordem quando todos os bloqueios de segurança estiverem satisfeitos.

O ambiente de produção trabalha com mercados **NORMAL** (OTC é filtrado), candles de 5 segundos e vencimento-alvo de 300 segundos. A conta padrão é **PRACTICE**; a conta REAL começa e permanece desarmada até uma ação explícita do operador.

## Como o sistema funciona

```text
IQ Option MCP oficial
        |
        +-- conta e catálogo NORMAL
        +-- candles de 5 segundos
        |
        v
Buffers por mercado (mínimo: 40 candles)
        |
        v
V3: oportunidade -> medições -> especialistas -> consenso -> desafio final
        |
        v
janela exata de envio -> revalidação -> gates PRACTICE -> ordem MCP
        |
        v
registro da execução e liquidação
```

O relay usa o MCP oficial da IQ como fonte primária para conta, catálogo e candles quando o WebSocket direto não sustenta uma sessão. O WebSocket pode continuar existindo para compatibilidade e relógio, mas não é usado como fonte concorrente de candles para mercados NORMAL. Isso evita que uma queda do socket antigo transforme um feed MCP saudável em um falso estado de “sem feed”.

## Estratégia V3

A V3 é orientada pela expiração da operação. Para cada mercado e cada vencimento elegível, ela cria uma oportunidade somente dentro da janela de análise, entre aproximadamente 330 e 300 segundos antes do vencimento. Cada candle fechado pode gerar um ciclo de análise.

1. **Medições:** preço, volatilidade, estrutura e indicadores são calculados a partir de candles fechados.
2. **Especialistas:** RSI, DMI/ADX, Bollinger, ATR e Price Action analisam o mesmo conjunto de dados.
3. **Cenário:** a camada de ativo classifica o contexto e registra tese, riscos e invalidações.
4. **Pré-filtro e consenso:** os agentes avaliam evidências e contrapontos; o consenso final pode aprovar compra, aprovar venda ou cancelar.
5. **Desafio final:** bloqueios, invalidações, tempo restante e direção são checados novamente.
6. **Execução:** somente uma aprovação final, com vencimento exato, chega ao callback operacional. Em PRACTICE ele ainda exige sistema armado, AUTO ligado, stake válido, mercado NORMAL suportado, conta pronta e kill switch liberado. Em REAL exige as confirmações adicionais e permanece fail-closed.

Uma decisão `WAIT` ou `CANCEL` é um resultado correto: não existe ordem quando as evidências são insuficientes, quando o feed está atrasado ou quando a janela expirou.

## Segurança operacional

- Segredos e credenciais ficam somente no servidor; nunca no bundle do navegador, logs ou repositório.
- A senha informada no painel é usada somente para renovar a sessão e é limpa do formulário.
- PRACTICE e REAL usam a mesma análise; a diferença é decidida apenas no roteamento da conta.
- REAL inicia desarmado após reinício ou deploy e não pode ser ativado por automação silenciosa.
- Uma operação usa a expiração da própria oportunidade. O sistema não persegue uma janela já perdida.
- Cada ciclo, consenso, bloqueio e execução pode ser consultado pelos endpoints V3 e pelo Log do painel.

## Estados úteis do painel

| Indicador | Significado |
|---|---|
| `READY` | Há feed recente e número suficiente de candles para a V3 analisar. |
| `Ativos READY` | Mercados com pelo menos 40 candles no buffer. |
| `PRACTICE` | Conta de simulação selecionada. |
| `REAL desarmado` | Proteção esperada; nenhuma ordem real pode ser enviada. |
| `OBSERVE_ONLY` | A V3 está apenas registrando análises; não envia ordem. |
| `PRACTICE_GATED` | A V3 pode encaminhar uma aprovação, mas os gates de PRACTICE ainda decidem se a ordem é permitida. |

## Operação e validação

O estado do runtime pode ser acompanhado sem expor segredos:

- `GET /api/iq/v3/status` — saúde V3, mercados prontos, ciclos, agentes, scheduler e MCP.
- `GET /api/iq/v3/opportunities` — oportunidades, ciclos, consenso e referência de execução.
- `GET /api/iq/status` — sessão, conta e readiness do broker.

Antes de habilitar qualquer execução, valide: `health=READY`, `feedReadyMarkets > 0`, `mcp.candlesLoaded > 0`, conta PRACTICE pronta e nenhuma razão no readiness de execução. Para validar uma ordem, use apenas PRACTICE, com stake mínimo, e confira depois o registro de execução e a liquidação.

## Desenvolvimento

Requer Node.js 22 ou superior.

```bash
npm install
npm run build
npm run check:relay
npx vitest run tests/v3 tests/ai/iq-mcp-adapter.test.ts
```

Configure segredos exclusivamente nas variáveis do serviço: `IQ_MCP_ENABLED`, `IQ_MCP_TOKEN`, `IQ_MCP_WRITE_ENABLED`, `IQ_OPTION_EMAIL`, `IQ_OPTION_PASSWORD` e as configurações V3. Nunca inclua valores reais em arquivos, commits ou documentação.

## Histórico

`PULLBACK_4060_300_AGENTIC_V2` continua preservada como referência histórica congelada e mantém estatísticas próprias. A tela e o fluxo operacional devem refletir o estado efetivo da V3; a transição para execução V3 exige ativação explícita e validação em PRACTICE.
