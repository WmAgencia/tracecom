# OFFICE V3 — INTEGRAÇÃO DOS NOVOS ASSETS PIXEL-ART

- Data: 2026-09-18 · modo PRACTICE · ZERO REAL · nenhuma ordem/stake tocado.
- Fonte dos assets: `D:\tracecom\repo` @ `05dd44f` (feat: sistema de assets pixel-art) + `13c6548` (docs: screenshots), mesmo repositório `WmAgencia/tracecom`.
- Destino: `src/http/public/assets/office/` + renderer em `src/http/public/office-v3/`.
- Deploy: `https://tracecom.consecom.com.br` (alias Vercel `tracecom-consecom.vercel.app`).

## 1. Inventário do que foi copiado

| origem | destino | conteúdo |
| --- | --- | --- |
| `src/http/public/assets/office/**` | idem | **102 arquivos**: 51 `manifest.json` (7 agentes, 19 móveis, 8 props, 4 pisos, 2 paredes, 5 decoração, 5 UI, 1 índice) + 50 PNG + `manifests/CREDITS.md` |
| `src/http/public/office-assets.js` | idem | loader global `OfficeAssets` (AssetManifestLoader/OfficeAssetRegistry/AgentSprite/Sprite/StationPlate/StationSet) |
| `src/http/public/office-sandbox.html` + `office-sandbox.js` | idem | sandbox visual de validação (agentes, móveis, estação, lounge, copa, reunião, fonte) |
| `scripts/office-assets/**` | idem | gerador reproduzível + `check.mjs` + libs (arte original MIT) |
| `tests/office-assets.test.ts` | idem | validação de manifests/PNGs/anchors/animações (4 testes) |
| `docs/office-assets.md`, `docs/office/*.png` | idem | documentação e screenshots originais do pacote |
| `package.json` | idem | scripts `office:assets` / `office:assets:check` |

Não copiado de propósito: as alterações de `office.js`/`office-fixture.html` do commit de origem (integração do
escritório **legado**, que neste repo tem histórico próprio e testes próprios). Nada de trading/relay/WS/MCP foi
tocado. `git log` dos dois repos comparado: a linhagem de `D:\tracecom\repo` (assets) divergiu da `main` deste repo
(office-v3), então os artefatos de asset foram trazidos como arquivos novos — sem sobrescrever lógica.

Módulo novo do renderer: **`src/http/public/office-v3/pixel-assets.js`** (ES module, carregado em runtime,
`loadPixelAssets()` → registro com sprites/agentes; nunca lança; sem pack → `null` → fallback procedural).

## 2. Mapeamento asset → estação/agente

| asset | uso no Office V3 | observação |
| --- | --- | --- |
| `agents/agent_trader_blue` / `_amber` / `_teal` | **1 TraderSprite por mercado WORKING** | escolha determinística por `marketKey` (`pickTraderSpriteId`); OTC alterna amber/blue, demais blue/amber/teal |
| `agents/agent_critic` | **1 CriticSprite por mercado WORKING** | animação `work` (2 frames, 4 fps) via `AgentSprite.frame()` |
| `furniture/desk_trading` | **DeskSprite da estação** | desenhado no passe frontal (depois dos agentes) cobrindo o colo — composição do `StationSet` do sandbox; âncora alinhada à borda traseira da mesa real |
| `furniture/chair_office` | 2 cadeiras por mesa ativa (1 em mesa reservada) | desenhadas antes dos agentes |
| `props/prop_monitor` + `props/prop_mug` | props do tampo em mesa ativa | substituem monitor/keyboard procedurais |
| `ui/nameplate_wood` / `ui/station_plate` | disponíveis, **não usados** | a placa com o nome do ativo foi **preservada** no estilo entalhado procedural (`drawPixelPlaque`), sobre o DeskSprite |
| `floors/*`, `walls/*`, `decor/*`, demais `furniture/*` | disponíveis, **não usados** | geometria de piso do Office V3 é plana (grades) e os tiles são diamante isométrico 84×38; forçar mudaria posição/setores/câmera. Documentado como não-uso (sem forçar asset) |
| `ui/pixel_font` | disponível, não usado | fonte pixel do pacote; o texto do Office V3 continua na fonte bitmap interna (`drawPixelText`), garantindo acentos PT-BR |

Regras preservadas (inalteradas): hit-test por `station.cell`, `createAnchorResolver` (mesa/zoom/painel), clique,
wheel=scroll (Shift horizontal), Ctrl+wheel=zoom no cursor, Space+drag=pan, setores/ribbons, câmera/clamp, painel
direito, logs e settlement WIN/LOSS/DRAW.

## 3. Auditoria de contagem (4 números, medidos no browser real)

Fonte: `node scripts/office-v3-assets-check.mjs --url=https://tracecom.consecom.com.br/` (25/25 asserts PASS),
snapshot real de produção (`GET /api/iq/office`), relatório `docs/office-v3/assets-check.prod.report.json`.

| # | métrica | valor (produção) | origem exata |
| --- | --- | --- | --- |
| 1 | **REGISTRADOS** | **108** | `life.agents.length` — registry do `life.js` cria 1 trader + 1 critic para **cada** estação/marketKey (54 × 2) |
| 2 | **POSSÍVEIS** | **108** | 2 × nº de mercados do universo reconciliado (54). O layout tem 55 células; a 55ª é `RESERVED` e **não** gera agentes |
| 3 | **WORKING** | **60** | 2 × 30 mercados com estado derivado `WORKING` (OPEN + enabled + feed fresco), a mesma fonte `state-model.js` que o desk/painel usam |
| 4 | **RENDERIZADO no frame** | **60** | `life.lastDrawStats.drawn` — só os pares WORKING são desenhados; `duplicates=0`, `unique=60`, 30 mercados com exatamente `{trader:1, critic:1}` |

**Origem da diferença (30 WORKING × "106 = 53×2")**: os dois relatórios contam coisas diferentes.
- `106 = 53×2` é a **alocação do registry** (2 por mercado) de um snapshot com 53 mercados — todos os mercados
  recebem par, mesmo fechados/desabilitados. Hoje o universo é 54 → registry = **108** (2 por mercado).
- `30 WORKING` é a contagem de **mercados** no estado `WORKING` (não de agentes). Como cada mercado WORKING
  renderiza exatamente 2 sprites, o frame mostra **30 × 2 = 60**.
- Os outros 48 agentes registrados (24 mercados não-WORKING) existem no registry, porém ficam `hidden` e **não são
  desenhados** (0 agentes por mesa não-WORKING, provado no browser: nenhum marketKey não-WORKING em
  `renderedByMarket`). Não há normalização artificial: o renderer desenha o que o `state-model` deriva.

Conferência local (fixture determinística com 51 WORKING / 3 não-WORKING): registrados 108 · possíveis 108 ·
WORKING 102 · renderizados 102 — mesma identidade `rendered = working = 2 × WORKING` (`assets-check.fixture.report.json`, 28/28 PASS).

## 4. Browser real (Playwright + Chrome 153)

- `scripts/office-v3-assets-check.mjs` (novo): 28/28 asserts PASS no fixture local e 25/25 em produção:
  - pack ON: 7 agent sprites carregados, todos os WORKING com par exato trader+critic, nenhum não-WORKING
    renderizado (CLOSED/SUSPENDED/DISABLED/UNKNOWN/FEED OFFLINE), zero duplicação, zero contaminação entre
    marketKeys, zoom/toque no desk e painel direito OK;
  - pack OFF (`?assets=off`): fallback procedural renderiza os mesmos 60/102 agentes (nada some);
  - sandbox `/office-sandbox.html`: "49 assets carregados".
- `scripts/office-v3-browser-check.mjs` (existente, regressão): **53/53 asserts PASS** com os novos assets
  (pan, scroll vertical/horizontal, zoom no cursor, clamp de bordas, clique/painel, MESAS, troca de ativo, feed offline).

## 5. Screenshots (`docs/office-v3/screenshots/`)

| arquivo | conteúdo |
| --- | --- |
| `assets-procedural-before.png` | fallback procedural (`?assets=off`) — antes/depois |
| `assets-pack-boot.png` | escritório com o pack (fixture 51 WORKING) |
| `assets-pack-desk-focus.png` | mesa focada: trader+critic, desk/monitor/caneca, placa |
| `assets-pack-nonworking-empty.png` | mesas não-WORKING sem agentes |
| `assets-prod-pack-boot.png` / `assets-prod-pack-desk-focus.png` | produção real (30 WORKING / 60 agentes) |
| `assets-sandbox.png` | sandbox de assets copiado |

## 6. Validação técnica

- `npx vitest run tests/ai` → **751/751 verdes** (inclui `tests/office-assets.test.ts`).
- `npx tsc -p tsconfig.json --noEmit` → limpo.
- `npm run build` → OK (102 assets copiados para `dist`).
- Deploy `vercel --prod` → Ready; smoke `GET /` = **200**; `/office-v3/pixel-assets.js` e
  `/assets/office/manifests/office-assets.json` = 200.

## 7. Pendências honestas

1. Os tiles de piso/parede do pack são isométricos em diamante; o mundo do Office V3 é plano — não foram forçados
   (fallback procedural mantido e documentado).
2. `station_plate`/`nameplate_wood` não usados: a placa procedural foi preservada por requisito; trocar para o asset
   exigiria fontes/baseline novos e aumentaria o risco visual sem ganho funcional.
3. Desks do pack são desenhados com escala 152/174 ≈ 0,874 (não inteira) para preencher a geometria sem alterar
   hit-test/posição; com `imageSmoothingEnabled=false` não há blur, mas há descarte de pixel nas bordas diagonais.
4. `?assets=off` é um parâmetro de diagnóstico permanente (prova de fallback); não aparece na UI.
5. A seleção de variante do trader é determinística por `marketKey` (não usa dados de trading).
