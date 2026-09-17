# PIXEL OFFICE V2 — DECOMPOSIÇÃO DA REFERÊNCIA

> Especificação visual implementada por `src/http/public/office-v2.js`.
> A referência é um escritório isométrico de pixel art: um pregão de madeira com
> mesas em fileiras, placas de madeira entalhadas (EUR/USD, GBP/USD, US30,
> BTC/USD...), dois personagens sentados por mesa, quadro grande no topo
> ("RESULTADO DO DIA"), painéis laterais (Professor & Pesquisa, Sala de Reunião,
> Área de Lazer com sinuca + sofás, Cozinha, Data Center, mapa-múndi), plantas,
> tapetes, iluminação quente, piso azul-escuro com cabeçalhos de setor.

---

## 1. Escopo e princípios

- **Somente leitura.** O escritório é um render do JSON de `GET /api/iq/office`.
  Nenhuma decisão, ordem, gate ou persistência é tocada.
- **Zero assets externos.** Todo o pixel art é procedural (canvas 2D, retângulos
  com coordenadas inteiras, `imageSmoothingEnabled = false`).
- **Dados reais > estética.** Nomes de mesa vêm de `market.display`; P&L vem
  exclusivamente de resultados liquidados (`portfolio.settled` e
  `settlementState.lastResult/lastProfit`); nenhum P&L indicativo é desenhado.
- **Postos gerados da lista.** O número de mesas, setores e linhas é derivado de
  `office.markets` — nunca hardcoded.

## 2. Câmera e bounding box (leitura do quadro)

| Item | Valor da referência | Implementação |
| --- | --- | --- |
| Projeção | isométrica 2:1 (diamante 2×1) | `HALF_W = CELL/2 = 8`, `HALF_H = CELL_H/2 = 4` |
| Ângulo | ~30° (atan 0.5 ≈ 26,57°) | `isoProject(gx,gy) = ((gx-gy)·8, (gx+gy)·4)` |
| Recorte da cena | pregão central + alas laterais + quadro no topo | mundo de **106 × 76 células** |
| Extensão em tela | painel largo, topo com quadro, alas à direita/esquerda | bounds ≈ **1600 × 990 px** @ zoom 1 |
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
  mesas vizinhas + 2 fileiras de mesa + 1 fileira de cirulação.
  - fileira `slot.y+0` → cadeiras (personagens sentados);
  - fileiras `slot.y+1..2` → mesa (bloqueada);
  - fileira `slot.y+3` → corredor leste-oeste (livre, contíguo à fileira de
    cadeiras do posto seguinte ⇒ corredor visual de 2 células).
- **Por fileira:** até **10 mesas** (`DESKS_PER_ROW`), 6 setores com mesas ⇒
  **9 fileiras** para os 55 mercados atuais.
- **Salão central:** ~54 × 58 células (x 20–74, y 14–72).
- **Cabeçalho de setor:** faixa de 3 fileiras antes da primeira fileira de mesas,
  com tarja colorida e texto na diagonal (rotação de atan(0.5)).

## 4. Proporções (personagem / mesa / sala)

| Elemento | Medida | Proporção |
| --- | --- | --- |
| Personagem sentado | 8 × 20 px (torso acima da mesa) | ~0,31 da largura da mesa (64 px) |
| Personagem em pé / supervisor | 8 × 28–30 px | ~0,44 da largura da mesa |
| Cadeira | 6 × 8 px | encaixa sob a mesa |
| Monitor | 12 × 8 px, 2 por mesa | 1 por agente |
| Placa entalhada | 58 × 14 px | 0,90 da face frontal da mesa |
| Sofá | 3 × 1 células, 8 px de assento + 16 px de encosto | ~1,6 personagens de largura |
| Mesa de sinuca | 4 × 3 células (64 × 48 px), 12 px de tampo | 2 personagens por lado |
| Quadro do dia | 470 × 214 px (≈ 29 × 27 células) | número principal ≈ 44 px |
| Salão | 54 × 58 células | quadro ≈ 25% da largura |

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

## 6. Setores (cabeçalhos do piso)

Ordem e placement das tarjas na referência (topo → base) e contagem derivada do
universo de 55 mercados:

| Setor | Rótulo | Regra | Mesas |
| --- | --- | --- | --- |
| `FOREX_MAJORS` | FOREX MAJORS | FX NORMAL do conjunto de majors | 6 |
| `FOREX_CROSSES` | FOREX CRUZADOS | FX NORMAL cruzado | 4 |
| `OTC_24H` | OTC - 24H | qualquer FX OTC | 30 |
| `CRYPTO` | CRIPTOMOEDAS | BTC/ETH/… (mesmo OTC) | 1 |
| `INDICES` | ÍNDICES | US30, US100, GER30, … | 12 |
| `COMMODITIES` | COMMODITIES | XAU/XAG/GOLD/SILVER/… | 2 |
| `OTHER` | OUTROS ATIVOS | fallback | 0 |

Índices/commodities/cripto têm prioridade de família sobre `marketType`; o
restante OTC cai em `OTC - 24H`. Setores vazios não geram faixa.

## 7. Alas laterais (placement fixo)

| Área | Grade (x,y,w,h) | Conteúdo |
| --- | --- | --- |
| Quadro RESULTADO DO DIA | 30,3,30,4 (bloqueado) | billboard centralizado sobre o salão |
| Mapa-múndi | 80,2,24,8 | painel na parede, continentes + pins piscando |
| Professor & Pesquisa | 80,12,24,20 | 3 estantes + estante lateral, mesa do professor, mesa de estudo, cavalete, quadro branco, mural |
| Sala de Reunião | 80,36,24,14 | mesa 8×3, 6 cadeiras, tela de agenda, 4 spots sociais |
| Área de Lazer | 80,54,24,20 | 2 tapetes, sinuca 4×3, 3 sofás, mesa de centro, plantas, 2 spots de sinuca + 3 de sofá |
| Cozinha | 2,12,16,18 | balcão, máquina de café (vapor animado), geladeira, ilha, 2 banquinhos, 2 spots de café + 2 de cozinha |
| Data Center | 2,36,16,16 | 5 racks com LEDs piscando, piso escuro |
| Parede norte | y = 2 | slab alto com 9 janelas quentes |

## 8. Paleta

| Uso | Hex |
| --- | --- |
| Vazio / fundo | `#0a0e1c` |
| Piso A / B (xadrez) | `#222b45` / `#1d253d` |
| Salão / corredor | `#26304b` / `#2b3550` |
| Madeira (tampo/face/lateral/claro) | `#a9743f` / `#6e4522` / `#8a5a2c` / `#c58a52` |
| Placa entalhada | base `#8a5a2c`, bisel `#d9a869`, sombra `#4f2c12`, texto `#2c1806` |
| Telas | ligada `#6fd3ff`, ok `#7ef0a0`, aviso `#ffd166`, desligada `#38455f` |
| Personagens | trader azul `#3f6fd8`, crítico roxo `#8b5cf6`, pele `#e8b48a`/`#c98d63` |
| Supervisor | terno `#2b3448`, gravata `#e0b84f` |
| Resultado | verde `#46d17a`, vermelho `#ff5a5a`, neutro `#cfd6e4`, âmbar `#ffc857` |
| Plantas | `#3f9b58` / `#2f7a44` / `#57bd72`, vaso `#a45a3a` |
| Servidores | `#22283a` / `#2d3550` |

## 9. Iluminação

- Paredes com 9 janelas em tons quentes (`#ffe0a8` / `#ffd28a`) e trilho
  inferior de madeira.
- 3 poças de luz radiais laranja (`rgba(255,186,102,0.10)`) sobre o salão, em
  modo `lighter`.
- Overlay quente final no centro do salão (`rgba(255,176,96,0.05)`), mantendo o
  contraste dos sprites.
- Telas de monitor com glow quando frescas/em posição; LEDs de rack piscando;
  vapor da cafeteira em 2 quadros.

## 10. Mobiliário (pixel art procedural)

Mesa de madeira com veios, 2 monitores com tela por estado do mercado, teclado,
caneca, papel, cadeiras; placa entalhada (bisel claro em cima, sombra escura em
baixo, texto gravado com realce +1 px); estantes com lombadas coloridas; mesas e
cadeiras de reunião; sinuca com 6 caçapas e bolas; sofás com almofadas; tapetes
com moldura dupla; balcão/ilha/geladeira/cafeteira/banquinhos; racks com LEDs
laterais; plantas com vaso e folhas em 3 tons; postes de placa para cada área;
quadro branco com curva desenhada; mural de gráfico; tela de reunião; mapa-múndi
com pins.

## 11. Regras de z-order

1. **Fundo e paredes** (camada estática offscreen): vazio, tiles de piso, piso
   do salão, faixas de setor, rótulos no piso, pisos das alas, tapetes, tapete de
   entrada, parede norte, poças de luz.
2. **Entidades ordenadas por `depth = gx + gy`** (pintor):
   - móveis das alas (centro do retângulo) e billboards (âncora − 0,4);
   - plantas;
   - mesa (`centro da mesa`) — as placas entram no draw da mesa;
   - personagens sentados (`seat.y < desk.y` ⇒ desenhados antes; o tampo cobre o
     colo e o torso fica visível);
   - supervisor e agentes em circulação (`x + y`);
   - quadro do dia (`rect.x + rect.y − 6`) e postes de setor.
3. **Overlays:** chips de P&L liquidado sobre as mesas, contorno de hover/seleção,
   glow quente, tudo antes de resetar o transform.
4. **Fundos de tela:** nada de HTML sobre a mesa — nomes de ativos são sempre
   desenhados no canvas (placa e rótulos). O painel lateral de detalhe é a única
   UI em DOM e fica fora do canvas.

## 12. Hierarquia visual

1. Número de **RESULTADO DO DIA** (44 px, verde/vermelho, blink sutil).
2. Métricas secundárias do quadro (WIN/LOSS/DRAW/WR/OPERAÇÕES/OPEN MARKETS,
   ARM, PRACTICE) e sparkline de equity liquidada.
3. Placas de madeira dos ativos (58 × 14 px, alto contraste).
4. Personagens (cores de camisa por papel: trader azul, crítico roxo).
5. Chips de resultado liquidado por mesa (9 s de vida após o settlement).
6. Cabeçalhos de setor no piso e placas das áreas.
7. Decoração (plantas, tapetes, luzes, LEDs).

## 13. Dados e regras de P&L

- **Quadro:** `office.portfolio.settled` → `{wins, losses, draws, pnl, trades}`;
  `pnl > 0` verde, `< 0` vermelho, `0` neutro; WR = `wins / (wins+losses)`.
- **Mesa:** apenas `settlementState.lastResult` (WIN/LOSS/DRAW) com
  `lastAt/lastProfit`; `WIN → +|profit|`, `LOSS → −|profit|`, `DRAW → R$ 0,00`.
  Posições abertas/indicativas **nunca** geram número — no máximo direção
  (CALL/PUT) na tela do monitor.
- **Painel lateral (clique na mesa):** ativo, marketKey, nome IQ (se existir),
  NORMAL/OTC, produto, activeId, disponibilidade, payout, freshness do feed,
  trader (ação/confiança/regime/viés/risco/evidências), crítico
  (veredito/contradições/risk flags/recomendação), consenso, regime, estrutura,
  setup, gatilho, entry location, micro veto, quality score + failed checks, JIT
  (estágio/segundos/drift), RSI, ADX, +DI/−DI, ATR, Donchian, micro streak,
  posição, último trade, resultado, P&L do dia e journal. Campo ausente → `—`.

## 14. Fixtures (teste visual, sem backend)

`office-v2-fixture.html` gera localmente os 55 mercados (mesmo universo do
runtime) e oferece:

| Botão | Cenário |
| --- | --- |
| A | 55 OPEN (10 habilitados, resultados liquidados mistos) |
| B | 37 OPEN |
| C | 10 OPEN |
| D | 0 OPEN (tudo CLOSED/UNAVAILABLE) |
| E | sequência 0 → 55 em passos de 11 (600 ms) |
| F | sequência 55 → 0 em passos de −11 (600 ms) |
| BAIXAR PNG | exporta `canvas.toDataURL("image/png")` |

Nenhum `fetch` é feito: o harness injeta `window.__OFFICE_V2_FIXTURE__` e
`bootOfficeV2({ fixture: true })`.

## 15. Lacunas de fidelidade conhecidas

1. **Sem sprite sheets.** Personagens e móveis são retângulos procedurais; não há
   atlas de pixel art com sombreamento fino como na referência.
2. **Fonte não-pixelada.** Texto usa `"Courier New"` (monoespaçada) com
   `textAlign`/`textBaseline` inteiros; não há bitmap font dedicada, então a
   placa entalhada tem menos "punch" que a referência.
3. **Perspectiva do quadro e das paredes.** O quadro e alguns billboards são
   retângulos alinhados à tela (estilo cartaz), não painéis isométricos
   perfeitos; a parede norte é uma faixa reta, não uma parede em L.
4. **Iluminação simplificada.** Sem sombras projetadas por sprite nem oclusão;
   apenas sombra elíptica sob móveis, poças de luz e vinheta.
5. **Composição menos densa.** A referência tem corredores mais largos, objetos
   de ambientação (cabos, quadros, luminárias) e mesas 2× maiores; aqui a
   densidade foi calibrada para caber 55 mesas legíveis em um único zoom 1.
6. **Animações discretas.** 2–3 quadros por ciclo (respiração, caminhada,
   LEDs, vapor); sem física, colisão entre agentes ou transições longas.
