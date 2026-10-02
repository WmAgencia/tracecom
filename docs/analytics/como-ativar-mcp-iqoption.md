# Como ativar o MCP "Iq Option" no Freebuff (para o agente poder usá-lo)

O servidor MCP "Iq Option" existe, mas o agente não consegue chamá-lo: as rotas locais do orquestrador (`/api/mcp/servers`) exigem o **launch token interno do aplicativo** (cookie `freebuff_launch_<porta>` / header `x-freebuff-launch-id`), que só o próprio app possui. O ID `WPMPEwG_E8iHtgzS2P__gRBI-dDNhSNccZmjvlVj` não é esse token (testado: 401 em todas as rotas/headers).

Para o MCP aparecer como ferramenta do agente, ele precisa estar **registrado e aprovado na sua sessão do Freebuff**. Faça isso na UI do app:

## Passo a passo na UI do Freebuff

1. Abra a conversa/aba do Freebuff Desktop onde este projeto está aberto.
2. Procure o painel/botão de **ferramentas do agente** (ícone de chave inglesa/tools, ou a seção "Tools"/"MCP" perto da caixa de mensagem; em versões recentes fica no menu de contexto da conversa).
3. Na lista de **MCP servers**, procure "Iq Option". Se aparecer com estado *pendente/aguardando aprovação*, clique em **Approve launch** (isso chama internamente `POST /api/mcp/servers/:serverId/approve-launch` do próprio app — autenticado corretamente).
4. Se **não aparecer** na lista: adicione um servidor MCP apontando para ele (o Freebuff aceita stdio ou http/sse). Para stdio você precisaria do comando executável do servidor — verifique com quem forneceu o ID se há um pacote/binary para instalar; para http/sse, use a URL do provedor do MCP.
5. Após aprovar, **reinicie esta conversa** (nova mensagem é suficiente): as ferramentas do MCP são descobertas na construção da sessão do agente.

## Como eu valido que funcionou

Assim que o MCP estiver ativo, diga apenas "MCP ativado" que eu:
1. Listo as ferramentas do servidor (ex.: list assets / get candles / histórico).
2. Puxo o **histórico máximo** de cada ativo OTC exposto (paginação até o limite do servidor), salvando em `diagnostic-results/data/iq-otc/<ativo>_<tf>.csv` com o mesmo esquema dos CSVs existentes (timestamp, OHLC, volume, quality, received_at) + `MANIFEST-OTC.json` com janela/qualidade/provenance.
3. Re-executo a mesma máquina de análise (`otc_proxy_pattern_analysis.mts` e `walk_forward_real.mts` adaptados ao schema) sobre os dados OTC reais e comparo com os resultados dos proxies.
4. Alimento o projeto de coleta prospectiva OTC (independente, sem misturar Yahoo/Binance).

## Enquanto isso

O runner forward paper (ETHUSDT 5m Bollinger ±2σ, H5/H1) segue coletando no feed real da Binance — sem depender do MCP. A ponte read-only (extensão + `MARKET_DATA_MODE=iqoption`) continua disponível como alternativa imediata para dados OTC reais prospectivos, sem histórico retroativo.

**Limitação honesta que permanece**: mesmo com o MCP, o histórico OTC é sintético e controlado pela IQ — serve para análise de padrões, mas o validador prospectivo (§4 do README do forward) continua sendo a régua para qualquer decisão real.
