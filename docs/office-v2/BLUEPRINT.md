# Pixel Office V2 — BLUEPRINT GEOMÉTRICO (autoritativo)

Fonte: `ChatGPT Image 17 de set. de 2026, 17_34_19.png` — tratada como **blueprint**, não inspiração.
Artboard lógico: **BASE_WIDTH = 1536, BASE_HEIGHT = 1024**. Toda geometria é definida neste espaço.
Proibido: flex/grid/space-between decidindo composição; conteúdo determinando geometria; FIT automático; reduzir mesas/personagens.

## Escala e mundo
- Viewport = 1536×1024 (equivalente ao enquadramento da referência).
- Mundo lógico **expandido** para caber 55 estações na escala da referência: `WORLD = 1536×1024` viewport sobre `WORLD_W≈2560 × WORLD_H≈1560` (pan). Nunca reduzir a mesa para caber.
- Mesa da referência: célula ≈ **124 px de largura**, altura total (tampo+frente+placa) ≈ **72 px**; passo vertical de banda ≈ **134 px**.

## BANDAS MACRO
| Banda | y | Conteúdo |
|---|---|---|
| SUPERIOR | 0–338 | logo, quadros, Professor/Pesquisa, lounge/sofás, plantas, painel RESULTADO DO DIA, mapa, café/cozinha, sinuca, áreas sociais |
| FOREX MAJORS | 338–452 | faixa + 10 mesas |
| FOREX CRUZADOS | 452–570 | faixa + 10 mesas |
| OTC + CRIPTO | 570–688 | 2 faixas + 5+5 mesas |
| ÍNDICES + COMMODITIES | 688–804 | 2 faixas + 5+5 mesas |
| OUTROS ATIVOS | 804–900 | faixa + 10 mesas |
| INFERIOR | 900–1024 | sofás, plantas, escadas, branding TRACE/COM, quadros, terraço, decoração |

## BANDA SUPERIOR — bounding boxes (x1,y1,x2,y2)
- Logo TRACE/COM: `14,14,232,92` (navy, logo circular dourado x30–62/y30–72, "TRACE/COM" branco, sub "DISCIPLINA · DADOS · RESULTADOS")
- Quadro "TRADER É UM JOGO DE LONGO PRAZO": `14,96,176,176`
- Quadro "FOCO / DISCIPLINA / PROCESSO / RESULTADO": `300,18,392,142`
- Painel PROFESSOR & PESQUISA: `12,184,132,392` (header 184–230; sala de pesquisa 232–305 com estante+mesa+pessoa; sublabels DADOS/TESTES/APRENDIZADO/EVOLUÇÃO 312–388)
- Painel SALA DE REUNIÃO: `12,398,132,562` (mesa + 4 pessoas)
- Painel PLANEJAMENTO/ESTRATÉGIA/PERFORMANCE/PRÓXIMOS PASSOS: `12,568,132,648`
- Painel DATA CENTER: `12,654,132,772` (racks; ESTABILIDADE/CONEXÃO/EXECUÇÃO/SEM INTERRUPÇÕES)
- **PAINEL RESULTADO DO DIA**: `524,6,908,218` — título `RESULTADO DO DIA`; número dominante `+R$ 578,76` (maior tipografia da tela, verde/vermelho); coluna esquerda métricas `538,126,652,205` (Operações Hoje, Wins, Losses, Win Rate, Maior Win, Maior Loss); equity chart `660,128,808,200` + eixo `09:00 12:00 15:00 18:00`
- Caixa MERCADOS: `914,6,1042,140` (Abertos/Fechados/Total)
- Caixa LUCRO SEMANAL: `914,146,1042,190`
- Caixa LUCRO MENSAL: `914,196,1042,240`
- Painel MAPA MUNDIAL: `1058,8,1268,152`
- Painel MERCADO GLOBAL 24H / OPORTUNIDADES EM TEMPO REAL: `1274,52,1438,142`
- Painel vermelho DISCIPLINA TRANSFORMA ESTRATÉGIA EM LIBERDADE: `1436,18,1530,124`
- Estátua touro dourado: `1442,126,1524,196`
- Lounge esquerdo (sofás+tapete+mesa centro): `300,120,530,305`
- Sinuca: `556,232,724,322`; placa "BOM TRADE TAMBÉM SE CELEBRA!": `738,236,826,284`
- Lounge direito: `838,228,1010,322`
- Café/cozinha: `1128,176,1338,330`; balcão `1130,250,1230,320`; prateleiras `1230,200,1330,260`; geladeira `1300,250,1340,320`; placa "CAFÉ / IDEIAS / TRADES / RESULTADOS" `1178,202,1244,262`
- Mesa de reunião: `1340,228,1502,322`

## COLUNA DIREITA (stack vertical, x 1400–1532)
- PAUSA TAMBÉM É ESTRATÉGIA + fliperama: `1400,330,1532,470`
- ÁREA DE LAZER (sinuca/videogame/conversa — RELAXAR VOLTAR MAIS FORTE) + sinuca pequena: `1400,500,1532,660`
- COZINHA (CAFÉ/ENERGIA/DISCIPLINA/BOM HUMOR): `1400,668,1532,790`
- TERRAÇO (pessoa na janela, skyline; RESPIRA ANALISA DECIDE MELHOR): `1400,796,1532,1000`

## TRADING FLOOR
Layout de 10 colunas: `x0=200`, largura de célula `124`, mesa ≈118. Centros: 262, 386, 510, 634, 758, 882, 1006, 1130, 1254, 1378.
- FOREX MAJORS — faixa `688,340,846,366`; mesas y `368–440`; ativos: EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, USD/CHF, NZD/USD, EUR/GBP, EUR/JPY, GBP/JPY
- FOREX CRUZADOS — faixa `688,458,846,484`; mesas y `486–556`; AUD/JPY, AUD/CAD, AUD/CHF, CAD/JPY, CHF/JPY, EUR/CAD, EUR/CHF, EUR/AUD, GBP/AUD, GBP/CHF
- OTC – 24H (5 PARES) — faixa `368,576,556,602`; mesas y `604–674`; EUR/USD OTC, GBP/USD OTC, USD/JPY OTC, EUR/GBP OTC, GBP/JPY OTC (x 200–820)
- CRIPTOMOEDAS — faixa verde `978,576,1152,602`; BTC/USD, ETH/USD, LTC/USD, XRP/USD, ADA/USD (x 824–1452)
- ÍNDICES — faixa `400,692,500,718`; S&P 500, NASDAQ, DOW JONES, DAX, FTSE 100 (x 200–820)
- COMMODITIES — faixa verde `998,692,1152,718`; GOLD, SILVER, WTI, BRENT, NATGAS (x 824–1452)
- OUTROS ATIVOS — faixa `688,808,846,834`; mesas y `836–898`; APPLE, TESLA, AMAZON, GOOGLE, META, MICROSOFT, NETFLIX, B3, IBOV, PETR4

## ANATOMIA DA ESTAÇÃO (componente crítico)
- Tampo isométrico claro (#b07a45) com highlight superior; frente grossa escura (#5c3a22); laterais (#8a5a34); sombra inferior.
- **Dois agentes** sentados, claramente visíveis (trader azul-marinho, critic roxo), **duas cadeiras** com encosto visível.
- Monitor escuro pequeno no tampo.
- **Placa frontal integrada**: nome entalhado/gravado na madeira (bevel + sombra interna), centrado, legível, dominante sobre o monitor. Não é botão/div/label sobreposta.
- **Badge de P&L flutuante acima da dupla**: verde `+R$ 8,50` (WIN), vermelho `−R$ 10,00` (LOSS), `R$ 0,00` (DRAW) — só de resultado liquidado real; mesa não-OPEN = sem agentes e sem badge.

## PERSONAGENS
- ~22–26 px visíveis sentados; cabeça, cabelo, rosto, tronco, braços, pernas, roupa, cadeira reconhecíveis.
- Variações de cabelo (preto/castanho/loiro/ruivo), pele, gravata; 110 agentes sem clones perfeitos, linguagem artística única.

## BANDA INFERIOR
- "DISCIPLINA HOJE RESULTADOS SEMPRE": `202,926,372,992`
- Escada esquerda: `400,890,520,1005`; escada direita: `1030,890,1150,1005`
- Branding central "TRACE/COM — VISION · SHADOW · RESULT" + tapete: `680,942,872,1012`
- "PEQUENAS DECISÕES GRANDES RESULTADOS": `1160,926,1332,992`
- Cluster sofás/tapete centro: `520,890,1030,1010`; plantas e luminárias ao longo da borda

## PALETA
- Piso navy `#0d1b2e` / linhas de tile `#14263d`; parede/painel `#101a2b`; borda dourada `#c9a24b`
- Madeira `#b07a45` / `#8a5a34` / `#5c3a22`
- Faixa setor azul `#1f4f8f` (highlight `#3a7bd5`), verde `#2f7d4f`, texto branco
- Verde financeiro `#3fbf5f`; vermelho `#e04b3a`
- Sofá creme `#d9c7a3`; feltro sinuca `#2f8b57`; tapete vermelho `#7a2f2a` / azul `#22406b`; planta `#3f8f4f`; vaso `#8a5a34`; luz âmbar `#f0b429`

## DENSIDADE
Sem grandes áreas vazias. Plantas, luminárias, tapetes, quadros, livros, móveis, divisórias, placas e decoração por toda parte. Contraste da referência (não escuro/vazio).

## ASSET KIT (sprites/tiles reutilizáveis)
wood_desk, chair, trader, critic, sofa, armchair, coffee_table, pool_table, plant_small, plant_large, bookshelf, lamp, wall_sconce, rug, kitchen_counter, fridge, research_desk, stairs, world_map, daily_board, monitor, plaque, pnl_badge.

## FASEAMENTO
1. Estação-mestre EUR/USD isolada → comparar com estação da referência (escala/madeira/personagens/cadeira/P&L/perspectiva/tipografia).
2. Replicar 10 colunas × 6 bandas.
3. Ligar dados reais (55 marketKeys), OPEN→trabalhando, CLOSED/DISABLED/SUSPENDED→vazia, idle→social, reopen→retorno, supervisor→patrol, P&L→real, click→painel, pan/zoom.
   A lógica dinâmica NUNCA altera a geometria-base.

## NÃO ALTERAR
Brain G2, Feature Engine, Critic, Consensus, Quality Gate, JIT, Execution Gate, Portfolio Gate. PRACTICE only. ZERO REAL.
