# PIXEL OFFICE V2 — DECOMPOSIÇÃO DA REFERÊNCIA

> Especificação visual implementada por `src/http/public/office-v2.js`.
> A referência é um escritório isométrico de pixel art: um pregão de madeira com
> mesas em fileiras, placas de madeira entalhadas (EUR/USD, GBP/USD, US30,
> BTC/USD...), dois personagens sentados por mesa, quadro grande no topo
> ("RESULTADO DO DIA"), pilhas de painéis laterais (esquerda/direita), faixa
> social central (sofás, sinuca, café, reunião), faixa inferior com tapete
> TRACE/COM, plantas, tapetes, iluminação quente, piso azul-escuro com fitas de
> setor azuis.

---

## 1. Escopo e princípios

- **Somente leitura.** O escritório é um render do JSON de `GET /api/iq/office`.
  Nenhuma decisão, ordem, gate ou persistência é tocada.
- **Zero assets externos.** Todo o pixel art é procedural (canvas 2D, retângulos
  com coordenadas inteiras, `imageSmoothingEnabled = false`).
- **Dados reais > estética.** Nomes de mesa vêm de `market.display`; P&L vem
  exclusivamente de resultados liquidados (`portfolio.settled` e
  `settlementState.lastResult/lastProfit`); nenhum P&L indicativo é desenhado.
  Campos ausentes viram `—`, nunca um número inventado.
- **Postos gerados da lista.** O número de mesas, setores e linhas é derivado de
  `office.markets` — nunca hardcoded. Os rótulos das fitas vêm do mapeamento de
  família (`sectorBand`), não de nomes de ativo.

## 2. Câmera e bounding box (leitura do quadro)

| Item | Valor da referência | Implementação |
| --- | --- | --- |
| Projeção | isométrica 2:1 (diamante 2×1) | `HALF_W = CELL/2 = 8`, `HALF_H = CELL_H/2 = 4` |
| Ângulo | ~30° (atan 0.5 ≈ 26,57°) | `isoProject(gx,gy) = ((gx-gy)·8, (gx+gy)·4)` |
| Recorte da cena | pregão central + alas laterais + quadro no topo | mundo de **106 × 76 células** |
| Extensão em tela | painel largo, topo com quadro, alas à direita/esquerda | bounds ≈ **1650 × 1060 px** @ zoom 1 (wallHeight 185) |
| Zoom | leitura de longe (pregão inteiro) e de perto (mesa) | escada fixa **0.5 / 1 / 2 / 3 / 4** |
| Pan | arrasto do quadro | pointer drag com `panBy` + `clampTo(bounds)` |
| Botões | FIT / CENTER / FOCUS | `fit()` / `center()` / `focusStation()` |

Razão de aspecto de referência ≈ 16:9 com o quadro ocupando ~15% da altura no
topo e o pregão ~70% no centro. O renderer aplica DPR e tradução inteira em
pixels de dispositivo para manter bordas duras.

## 3. Grade e escala

- **Tile isométrico:** 16 × 8 px (diamante). Uma célula de grade = 1 tile.
- **Mesa:** 4 células × 2 células (64 × 32 px de face; slab de 12 px de altura).
- **Módulo de posto (slot):** 5 × 4 células — 1 célula de corredor vertical entre
  mesas vizinhas + 2 fileiras de mesa + 1 fileira de circulação.
  - fileira `slot.y+0` → cadeiras (personagens sentados);
  - fileiras `slot.y+1..2` → mesa (bloqueada);
  - fileira `slot.y+3` → corredor leste-oeste (livre, contíguo à fileira de
    cadeiras do posto seguinte ⇒ corredor visual de 2 células).
- **Por fileira:** até **10 mesas** (`DESKS_PER_ROW`), 6 setores com mesas ⇒
  **9 fileiras** para os 55 mercados atuais.
- **Salão central:** ~54 × 58 células (x 20–74, y 14–72).
- **Faixa de setor:** 3 fileiras antes da primeira fileira de mesas, cobertas
  pela **fita azul** desenhada no piso (rótulo centralizado).

## 4. Proporções (personagem / mesa / sala)

| Elemento | Medida | Proporção |
| --- | --- | --- |
| Personagem sentado | 8 × 20 px (torso acima da mesa) | ~0,31 da largura da mesa (64 px) |
| Personagem em pé / supervisor | 8 × 28–30 px | ~0,44 da largura da mesa |
| Cadeira | 6 × 8 px | encaixa sob a mesa |
| Monitor | 12 × 8 px, 2 por mesa | 1 por agente |
| Placa entalhada | 58 × 14 px | 0,90 da face frontal da mesa |
| Badge de P&L | ≥ 46 × 15 px | flutua ~20 px acima do par |
| Sofá | 3 × 1 células, 8 px de assento + 16 px de encosto | ~1,6 personagens de largura |
| Mesa de sinuca | 4 × 3 células (64 × 48 px), 12 px de tampo | 2 personagens por lado |
| Quadro do dia | 540 × 248 px (≈ 34 × 31 células) | número principal ≈ 46 px |
| Salão | 54 × 58 células | quadro ≈ 33% da largura |

## 5. Circulação (corredores e acessibilidade)

- Corredores principais leste-oeste: `world.corridors` — a última fileira de cada
  posto (`slot.y + SLOT_D - 1`), **sempre caminháveis** (teste automatizado).
- Aisles norte-sul: margens do salão (x = 20–21 e 72–73) + fendas de 1 célula
  entre mesas (`slot.x + 4`), permitindo atravessar fileiras sem cruzar mesas.
- A* 4-direções determinístico (heap binário, tie-break por índice) com
  `isWalkable`; mesas, paredes, sofás, sinuca, cozinha, quadro, estantes,
  racks, plantas e o mapa-múndi são células bloqueadas.
- Supervisor: patrulha por waypoints (perímetro do salão + passarela sob o
  quadro) com A* entre pontos, WALK → STOP → OBSERVE → WAIT, sem teleporte
  (posição contínua, velocidade 1,05 célula/s).

## 6. Setores — FITAS (ribbons) por família

A referência tem **6 faixas de mesa**, duas delas com **duas fitas na mesma
linha** (metade esquerda / metade direita). O mapeamento é por família
(`SECTOR_BANDS` / `sectorBand`), nunca por ativo:

| Banda (`bandId`) | Fita esquerda | Fita direita | Regra de família | Mesas (universo 55) |
| --- | --- | --- | --- | --- |
| `BAND_FOREX_MAJORS` | **FOREX MAJORS** (full) | — | FX NORMAL major | 6 |
| `BAND_FOREX_CROSSES` | **FOREX CRUZADOS** (full) | — | FX NORMAL cruzado | 4 |
| `BAND_OTC_CRYPTO` | **OTC - 24H** (left) | **CRIPTOMOEDAS** (right) | FX OTC / BTC-ETH-LTC-XRP-ADA | 30 + 1 |
| `BAND_INDICES_COMMODITIES` | **ÍNDICES** (left) | **COMMODITIES** (right) | índices / XAU-XAG-GOLD… | 12 + 2 |
| `BAND_OTHER` | **OUTROS ATIVOS** (full) | — | fallback | 0 |

Conjunto exato de rótulos (`SECTOR_RIBBON_LABELS`):
`["FOREX MAJORS", "FOREX CRUZADOS", "OTC - 24H", "CRIPTOMOEDAS", "ÍNDICES", "COMMODITIES", "OUTROS ATIVOS"]`.

`planStationLayout` grava `bandId`/`bandSide` em cada setor; `sectorRibbonBands`
resolve, para cada banda, o retângulo da fita e as metades `leftHalf`/`rightHalf`
(contíguas no centro). Índices/commodities/cripto têm prioridade de família sobre
`marketType`; o restante OTC cai em `OTC - 24H`. Setores vazios não geram fita.

## 7. Quadro RESULTADO DO DIA (topo, dominante)

Layout medido, 540 × 248 px, todos os valores do JSON real:

| Região | Conteúdo | Fonte |
| --- | --- | --- |
| Título | `RESULTADO DO DIA` | estático |
| Número gigante | `+R$ 578,76` (verde/vermelho/neutro) | `portfolio.settled.pnl` |
| Coluna esquerda | `Operações Hoje`, `Wins`, `Losses`, `Win Rate`, `Maior Win`, `Maior Loss` | `settled.trades/wins/losses`, `wins/(wins+losses)`, máximo/mínimo de `settlementState.lastProfit` |
| Centro | gráfico de equity verde com eixo `09:00 12:00 15:00 18:00` | `portfolio.equityCurve[].cumulative` |
| Caixa direita | `MERCADOS` → `Abertos`, `Fechados`, `Total` | contagem `availability === "OPEN" && enabled` vs total |
| Abaixo da caixa | `LUCRO SEMANAL`, `LUCRO MENSAL` | `portfolio.weekly.pnl` / `portfolio.monthly.pnl` (ou chaves equivalentes) → `—` quando ausente |
| Rodapé | `PRACTICE/REAL`, `ARM …`, `AGENTES x/y` | `mode`, `aux.compliance.armState`, `activeCount/activeLimit` |

`pnlIndicatorModel` expõe `openMarkets`, `closedMarkets`, `totalMarkets`,
`bestWinText`, `bestLossText`, `weeklyText`, `monthlyText`, `winRateText`
(`76.2%`). Nunca inventa número.

## 8. Pilhas laterais (painéis de parede)

Dados em `SIDE_PANELS`, ancorados por `SIDE_PANEL_ANCHORS` (9 na esquerda, 94 na
direita). Sem leitura pela simulação.

**Esquerda (topo → base):** `TRACE/COM` + `DISCIPLINA · DADOS · RESULTADOS`;
`FOCO DISCIPLINA PROCESSO RESULTADO`; `TRADER É UM JOGO DE LONGO PRAZO`;
`PROFESSOR & PESQUISA` + `DADOS TESTES APRENDIZADO EVOLUÇÃO`; `SALA DE REUNIÃO`;
`PLANEJAMENTO ESTRATÉGIA PERFORMANCE PRÓXIMOS PASSOS`; `DATA CENTER` +
`ESTABILIDADE CONEXÃO EXECUÇÃO SEM INTERRUPÇÕES`.

**Direita (topo → base):** `DISCIPLINA TRANSFORMA ESTRATÉGIA EM LIBERDADE`
(painel vermelho); `MERCADO GLOBAL 24H OPORTUNIDADES EM TEMPO REAL` (mapa azul,
área `WorldMapPanel`); touro dourado (`drawBullStatue`); `PAUSA TAMBÉM É
ESTRATÉGIA` + fliperama (`drawArcadeCabinet`); `ÁREA DE LAZER` + `sinuca
videogame conversa — RELAXAR VOLTAR MAIS FORTE`; `COZINHA` + `café energia
disciplina bom humor`; `TERRAÇO` + `RESPIRA ANALISA DECIDE MELHOR`.

## 9. Faixa social central e faixa inferior

`SocialBandArea` (grade x24–82, y8–15), entre o quadro e o salão:

- 2 conjuntos de sofás **creme** (`#e8d9b5`) sobre tapetes vermelho/azul, com
  mesas de centro;
- mesa de sinuca de feltro verde (`#2e8b57`) com bolas e taco;
- balcão de café com 3 banquinhos e máquina de café;
- mesa de reunião à direita com 4 cadeiras;
- placas penduradas: **`BOM TRADE TAMBÉM SE CELEBRA!`** e
  **`CAFÉ IDEIAS TRADES RESULTADOS`**;
- 6 vasos de plantas na borda inferior.

**Faixa inferior** (`drawBottomBand` + placas): tapete central vermelho com
`TRACE/COM` e `VISION · SHADOW · RESULT`; placa esquerda `DISCIPLINA HOJE
RESULTADOS SEMPRE`; placa direita `PEQUENAS DECISÕES GRANDES RESULTADOS`.

## 10. Anatomia da mesa

Mesa isométrica de madeira quente (`#8a5a34` tampo, `#6b4326` face/sombra,
`#a9743f` claro) com veios, 2 monitores escuros, caneca e papel. Sobre a mesa:

- **2 agentes sentados** lado a lado — trader azul-marinho (`#2f4f8a`), crítico
  roxo (`#7c4fd0`) — posicionados atrás do tampo (torso visível);
- **placa entalhada** na face frontal, texto escuro gravado (`#3f2410` base,
  bisel `#d9a441`, texto `#2c1806`), centralizada e dominante sobre o monitor;
- **badge flutuante de P&L** acima do par, somente com resultado liquidado:
  verde `+R$ 8,50` (WIN), vermelho `−R$ 10,00` (LOSS), `R$ 0,00` (DRAW).
- Mesas **vazias** (`isDeskActive === false`: DISABLED/SUSPENDED/NOT_OFFERED/
  UNKNOWN/CLOSED) não mostram agentes nem badge, mesmo com settlement antigo.

## 11. Paleta (hex da referência)

| Uso | Hex |
| --- | --- |
| Vazio / fundo | `#0a0e1c` |
| Piso navy A / B | `#0e1b2e` / `#0c1728` |
| Linhas de tile | `#17283f` (stroke `rgba(48,82,128,0.16)`) |
| Salão / corredor | `#101f33` / `#16273f` |
| Madeira (tampo/face/sombra/claro) | `#8a5a34` / `#6b4326` / `#7a4d2c` / `#a9743f` |
| Placa entalhada | base `#7a4d2c`, bisel `#d9a441`, sombra `#3f2410`, texto `#2c1806` |
| Ouro / âmbar | `#d9a441` |
| Positivo / negativo | `#4fbf6a` / `#d9534f` |
| Sofás creme | `#e8d9b5` / `#c9b48c` / `#f2e8cf` |
| Sinuca (feltro) | `#2e8b57` |
| Tapetes | vermelho `#7d2b2b` / azul `#26466b` |
| Personagens | trader `#2f4f8a`, crítico `#7c4fd0`, pele `#e8b48a`/`#c98d63` |
| Supervisor | terno `#2b3448`, gravata `#d9a441` |
| Plantas | `#3f9b58` / `#2f7a44` / `#57bd72`, vaso `#a45a3a` |
| Servidores | `#22283a` / `#2d3550` |
| Quadro | fundo `#0b1728`, moldura `#6b4326`/`#8a5a34` |

## 12. Iluminação

- Parede norte com 9 janelas em tons quentes (`#ffe0a8` / `#ffd28a`), trilho de
  madeira e **9 arandelas douradas** com poças âmbar.
- 3 poças de luz radiais laranja (`rgba(255,186,102,0.10)`) sobre o salão, em
  modo `lighter`.
- Overlay quente final no centro do salão (`rgba(255,176,96,0.05)`) + **vinheta**
  radial (`rgba(0,0,0,0.4)` nas bordas), mantendo o contraste dos sprites.
- Telas de monitor com glow; LEDs de rack piscando; vapor da cafeteira; painel
  do fliperama animado.

## 13. Mobiliário (pixel art procedural)

Mesa de madeira com veios, 2 monitores, teclado, caneca, papel, cadeiras; placa
entalhada (bisel claro em cima, sombra escura em baixo, texto gravado com realce
+1 px); estantes com lombadas; mesas e cadeiras de reunião; sinuca com caçapas e
bolas; sofás creme com almofadas; tapetes com moldura dupla; balcão/ilha/
geladeira/cafeteira/banquinhos; racks com LEDs; plantas com vaso e folhas em 3
tons; postes de placa; quadro branco, mural, tela de reunião; mapa-múndi com
pins; touro dourado; fliperama; placas penduradas.

## 14. Regras de z-order

1. **Fundo e paredes** (camada estática offscreen): vazio, tiles de piso, piso do
   salão, pisos dos setores, **fitas de setor azuis**, pisos das alas, grade de
   tiles sutil, tapetes, tapete de entrada, faixa inferior, parede norte com
   janelas e arandelas, poças de luz.
2. **Entidades ordenadas por `depth = gx + gy`** (pintor):
   - móveis das alas (centro do retângulo), incluindo faixa social, e billboards
     (âncora − 0,4) — placas penduradas e painéis laterais;
   - plantas;
   - mesa (`centro da mesa`) — as placas entram no draw da mesa;
   - personagens sentados (`seat.y < desk.y` ⇒ desenhados antes; o tampo cobre o
     colo e o torso fica visível);
   - supervisor e agentes em circulação (`x + y`);
   - quadro do dia (`rect.x + rect.y − 6`).
3. **Overlays:** **badges flutuantes de P&L liquidado** sobre as mesas, contorno
   de hover/seleção, glow quente e vinheta, antes de resetar o transform.
4. **Fundos de tela:** nada de HTML sobre a mesa — nomes de ativos são sempre
   desenhados no canvas (placa e fitas). O painel lateral de detalhe é a única UI
   em DOM e fica fora do canvas.

## 15. Hierarquia visual

1. Número de **RESULTADO DO DIA** (46 px, verde/vermelho, blink sutil).
2. Métricas do quadro (Wins/Losses/Win Rate/Maior Win/Maior Loss, MERCADOS,
   lucro semanal/mensal) e gráfico de equity.
3. Placas de madeira dos ativos (58 × 14 px, alto contraste).
4. Badges flutuantes de P&L liquidado por mesa.
5. Personagens (trader azul, crítico roxo).
6. Fitas de setor azuis e placas das áreas.
7. Decoração (plantas, tapetes, luzes, LEDs, vinheta).

## 16. Dados e regras de P&L

- **Quadro:** `office.portfolio.settled` → `{wins, losses, draws, pnl, trades}`;
  `pnl > 0` verde, `< 0` vermelho, `0` neutro; WR = `wins / (wins+losses)`.
- **Mesa:** apenas `settlementState.lastResult` (WIN/LOSS/DRAW) com
  `lastAt/lastProfit`; `WIN → +|profit|`, `LOSS → −|profit|`, `DRAW → R$ 0,00`.
  Posições abertas/indicativas **nunca** geram número — no máximo direção
  (CALL/PUT) na tela do monitor.
- **Badge:** `deskBadgeModel` só é `visible` quando `isDeskActive` (enabled e
  OPEN) **e** há resultado liquidado.
- **Painel lateral (clique na mesa):** ativo, marketKey, nome IQ (se existir),
  NORMAL/OTC, produto, activeId, disponibilidade, payout, freshness do feed,
  trader, crítico, consenso, regime, estrutura, setup, gatilho, entry location,
  micro veto, quality score + failed checks, JIT, RSI, ADX, +DI/−DI, ATR,
  Donchian, micro streak, posição, último trade, resultado, P&L do dia e
  journal. Campo ausente → `—`.

## 17. Fixtures (teste visual, sem backend)

`office-v2-fixture.html` gera localmente os 55 mercados (mesmo universo do
runtime) e oferece:

| Botão | Cenário |
| --- | --- |
| A | **55 OPEN — todos os 55 postos ocupados**, resultados liquidados mistos (FIXTURE SINTÉTICO) |
| B | 37 OPEN |
| C | 10 OPEN |
| D | 0 OPEN (tudo CLOSED/UNAVAILABLE) |
| E | sequência 0 → 55 em passos de 11 (600 ms) |
| F | sequência 55 → 0 em passos de −11 (600 ms) |
| BAIXAR PNG | exporta `canvas.toDataURL("image/png")` |

Nenhum `fetch` é feito: o harness injeta `window.__OFFICE_V2_FIXTURE__` e
`bootOfficeV2({ fixture: true })`. A fixture inclui `portfolio.weekly/monthly`
para exercitar o quadro; nenhum dado real é usado.

## 18. Lacunas de fidelidade conhecidas

1. **Sem sprite sheets.** Personagens e móveis são retângulos procedurais; não há
   atlas de pixel art com sombreamento fino como na referência.
2. **Fonte não-pixelada.** Texto usa `"Courier New"` (monoespaçada) com
   `textAlign`/`textBaseline` inteiros; não há bitmap font dedicada, então a
   placa entalhada tem menos "punch" que a referência.
3. **Perspectiva do quadro e das paredes.** O quadro, os painéis laterais e
   algumas placas são retângulos alinhados à tela (estilo cartaz), não painéis
   isométricos perfeitos; a parede norte é uma faixa reta, não uma parede em L.
4. **Split de fita lógico.** Na referência OTC+CRIPTO e ÍNDICES+COMMODITIES
   dividem fisicamente a mesma linha (5+5). Aqui o split é da **fita** (rótulo
   esquerdo/direito na mesma banda) enquanto as mesas seguem o layout por família
   (OTC ocupa 3 linhas cheias), para caber os 55 mercados reais.
5. **Iluminação simplificada.** Sem sombras projetadas por sprite nem oclusão;
   apenas sombra elíptica sob móveis, poças de luz e vinheta.
6. **Composição menos densa.** A referência tem corredores mais largos e mais
   objetos de ambientação; aqui a densidade foi calibrada para 55 mesas legíveis
   em um único zoom 1.
7. **Animações discretas.** 2–3 quadros por ciclo (respiração, caminhada, LEDs,
   vapor, fliperama); sem física nem colisão entre agentes.
8. **Números do quadro.** Semana/mês usam as chaves presentes no JSON
   (`portfolio.weekly/monthly`); quando o runtime não as expõe, o quadro mostra
   `—` (nunca estimativas).
