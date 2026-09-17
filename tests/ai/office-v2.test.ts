/**
 * PIXEL OFFICE V2 — testes das partes puras (sem DOM).
 *
 * Importa o módulo visual `src/http/public/office-v2.js` (ESM puro) e valida:
 * geração de postos, setores, colisão de mesas, corredores, A*, occupancy,
 * P&L liquidado, câmera, placa entalhada e a máquina de estado do supervisor.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - relay ESM sem tipagem (validado em runtime)
const universeModule = await import("../../relay/market-universe.mjs");
// @ts-expect-error - módulo visual ESM sem tipagem, importável sem DOM
const officeModule = await import("../../src/http/public/office-v2.js");

const { UNIVERSE, marketKey } = universeModule as unknown as Record<string, any>;
const {
  buildOfficeWorld,
  planStationLayout,
  sectorForMarket,
  sectorBand,
  sectorRibbonBands,
  SECTOR_RIBBON_LABELS,
  SIDE_PANELS,
  OfficeWorld,
  rectContains,
  OfficeGrid,
  PathfindingSystem,
  OccupancySystem,
  OfficeCamera,
  computePlateLayout,
  pnlIndicatorModel,
  deskPnlIndicator,
  deskBadgeModel,
  isDeskActive,
  marketDetailRows,
  AgentStateMachine,
  SupervisorPatrol,
  SUPERVISOR_PATROL_LOOP,
  SUPERVISOR_STAGE_MS,
} = officeModule as unknown as Record<string, any>;

function fixtureMarkets() {
  return UNIVERSE.map((entry: any) => ({
    marketKey: marketKey(entry.canonical, entry.marketType),
    canonical: entry.canonical,
    symbol: entry.symbol,
    display: entry.display,
    marketType: entry.marketType,
    availability: "OPEN",
    enabled: true,
    positionState: { status: "IDLE" },
  }));
}

function fixtureOffice(extra: Record<string, unknown> = {}) {
  return {
    version: "iq-multi-runtime-v2",
    at: Date.now(),
    connection: { connected: true },
    mode: "PRACTICE",
    activeCount: 10,
    activeLimit: 10,
    portfolio: {
      settled: { wins: 14, losses: 11, draws: 1, pnl: 0.48, trades: 26 },
      openPositions: [],
      equityCurve: [],
    },
    markets: fixtureMarkets(),
    ...extra,
  };
}

describe("OFFICE V2 — mundo e layout", () => {
  it("gera 55 postos a partir dos 55 mercados do runtime", () => {
    const world = buildOfficeWorld(fixtureOffice());
    expect(UNIVERSE).toHaveLength(55);
    expect(world.stations).toHaveLength(55);
    expect(new Set(world.stations.map((station: any) => station.marketKey)).size).toBe(55);
  });

  it("atribui setores por família/tipo (NORMAL, OTC, índices, commodities, cripto)", () => {
    expect(sectorForMarket({ canonical: "EURUSD", marketType: "NORMAL" })).toBe("FOREX_MAJORS");
    expect(sectorForMarket({ canonical: "GBPJPY", marketType: "NORMAL" })).toBe("FOREX_CROSSES");
    expect(sectorForMarket({ canonical: "AUDNZD", marketType: "OTC" })).toBe("OTC_24H");
    expect(sectorForMarket({ canonical: "US30", marketType: "NORMAL" })).toBe("INDICES");
    expect(sectorForMarket({ canonical: "XAUUSD", marketType: "NORMAL" })).toBe("COMMODITIES");
    expect(sectorForMarket({ canonical: "BTCUSD", marketType: "OTC" })).toBe("CRYPTO");
    expect(sectorForMarket({ canonical: "ZZZ9", marketType: "NORMAL" })).toBe("OTHER");
    const world = buildOfficeWorld(fixtureOffice());
    const counts = Object.fromEntries(world.sectors.map((sector: any) => [sector.id, sector.count]));
    expect(counts.FOREX_MAJORS).toBe(6);
    expect(counts.FOREX_CROSSES).toBe(4);
    expect(counts.OTC_24H).toBe(30);
    expect(counts.INDICES).toBe(12);
    expect(counts.COMMODITIES).toBe(2);
    expect(counts.CRYPTO).toBe(1);
  });

  it("não existe sobreposição entre as mesas (retângulos únicos)", () => {
    const world = buildOfficeWorld(fixtureOffice());
    const desks = world.stations.map((station: any) => station.desk);
    for (let i = 0; i < desks.length; i += 1) {
      for (let j = i + 1; j < desks.length; j += 1) {
        const a = desks[i];
        const b = desks[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${world.stations[i].marketKey} x ${world.stations[j].marketKey}`).toBe(false);
      }
    }
  });

  it("corredores permanecem caminháveis e livres de mesas", () => {
    const world = buildOfficeWorld(fixtureOffice());
    expect(world.corridors.length).toBeGreaterThan(0);
    for (const corridor of world.corridors) {
      for (let x = corridor.x; x < corridor.x + corridor.w; x += 1) {
        expect(world.grid.isWalkable(x, corridor.y), `célula ${x},${corridor.y}`).toBe(true);
      }
      for (const station of world.stations) {
        const desk = station.desk;
        const hit = corridor.x < desk.x + desk.w && desk.x < corridor.x + corridor.w && corridor.y < desk.y + desk.h && desk.y < corridor.y + corridor.h;
        expect(hit, `corredor y=${corridor.y} x mesa ${station.marketKey}`).toBe(false);
      }
    }
  });

  it("layout agrupa setores em linhas de no máximo 10 mesas dentro do salão", () => {
    const layout = planStationLayout(fixtureMarkets());
    expect(layout.stations).toHaveLength(55);
    expect(layout.desksPerRow).toBe(10);
    for (const sector of layout.sectors) {
      for (const row of sector.rows) expect(row.stationIds.length).toBeLessThanOrEqual(10);
    }
    const otc = layout.sectors.find((sector: any) => sector.id === "OTC_24H");
    expect(otc.rows).toHaveLength(3);
    for (const station of layout.stations) expect(rectContains(layout.hall, station.slot)).toBe(true);
  });
});

describe("OFFICE V2 — pathfinding e occupancy", () => {
  it("A* contorna mesas ao ir da cadeira até o corredor", () => {
    const world = buildOfficeWorld(fixtureOffice());
    const pathfinding = new PathfindingSystem(world.grid);
    const station = world.stations[0];
    const start = station.seat[0];
    const goal = { x: start.x, y: station.slot.y + station.slot.h - 1 };
    const path = pathfinding.findPath(start, goal);
    expect(path).not.toBeNull();
    expect(path[0]).toEqual({ x: start.x, y: start.y });
    expect(path[path.length - 1]).toEqual(goal);
    expect(path.length).toBeGreaterThan(goal.y - start.y + 1);
    for (const point of path) {
      const insideDesk = point.x >= station.desk.x && point.x < station.desk.x + station.desk.w && point.y >= station.desk.y && point.y < station.desk.y + station.desk.h;
      expect(insideDesk, `passo dentro da mesa: ${point.x},${point.y}`).toBe(false);
      expect(world.grid.isWalkable(point.x, point.y)).toBe(true);
    }
    for (let index = 1; index < path.length; index += 1) {
      const dx = Math.abs(path[index].x - path[index - 1].x);
      const dy = Math.abs(path[index].y - path[index - 1].y);
      expect(dx + dy).toBe(1);
    }
  });

  it("A* retorna null quando o caminho está selado", () => {
    const grid = new OfficeGrid(10, 5);
    grid.blockRect(5, 0, 1, 5);
    const pathfinding = new PathfindingSystem(grid);
    expect(pathfinding.findPath({ x: 2, y: 2 }, { x: 8, y: 2 })).toBeNull();
    grid.setWalkable(5, 2, true);
    expect(pathfinding.findPath({ x: 2, y: 2 }, { x: 8, y: 2 })).not.toBeNull();
  });

  it("occupancy nunca excede a capacidade e libera reservas", () => {
    const occupancy = new OccupancySystem([{ id: "s1", kind: "leisure", x: 1, y: 1, capacity: 2 }]);
    expect(occupancy.reserve("s1", "a").ok).toBe(true);
    expect(occupancy.reserve("s1", "b").ok).toBe(true);
    expect(occupancy.occupancy("s1")).toBe(2);
    expect(occupancy.reserve("s1", "c")).toEqual({ ok: false, reason: "FULL" });
    expect(occupancy.occupancy("s1")).toBeLessThanOrEqual(occupancy.capacity("s1"));
    expect(occupancy.release("s1", "a")).toBe(true);
    expect(occupancy.reserve("s1", "c").ok).toBe(true);
    expect(occupancy.occupancy("s1")).toBe(2);
    expect(occupancy.reserve("s1", "b")).toEqual({ ok: false, reason: "ALREADY_RESERVED" });
    const world = buildOfficeWorld(fixtureOffice());
    const worldOccupancy = new OccupancySystem(world.spots);
    for (const spot of world.spots) {
      for (let index = 0; index < 10; index += 1) worldOccupancy.reserve(spot.id, `agent-${spot.id}-${index}`);
    }
    for (const spot of world.spots) expect(worldOccupancy.occupancy(spot.id)).toBeLessThanOrEqual(spot.capacity);
  });
});

describe("OFFICE V2 — P&L liquidado e câmera", () => {
  it("indicador de mesa usa apenas resultado liquidado (WIN/LOSS/DRAW)", () => {
    const win = deskPnlIndicator({ settlementState: { lastResult: "WIN", lastProfit: 1.7 } });
    expect(win.tone).toBe("POSITIVE");
    expect(win.pnl).toBeCloseTo(1.7);
    expect(win.text.startsWith("+R$")).toBe(true);
    const loss = deskPnlIndicator({ settlementState: { lastResult: "LOSS", lastProfit: -2 } });
    expect(loss.tone).toBe("NEGATIVE");
    expect(loss.pnl).toBeCloseTo(-2);
    expect(loss.text.startsWith("-R$")).toBe(true);
    const draw = deskPnlIndicator({ settlementState: { lastResult: "DRAW", lastProfit: 0 } });
    expect(draw.tone).toBe("ZERO");
    expect(draw.pnl).toBe(0);
    expect(draw.text).toBe("R$ 0,00");
    const indicativeOnly = deskPnlIndicator({ positionState: { status: "OPEN" }, indicative: { state: "FAVORABLE", indicativePnl: 1.72 } });
    expect(indicativeOnly.tone).toBe("NONE");
    expect(indicativeOnly.pnl).toBeNull();
    expect(indicativeOnly.text).toBe("—");
  });

  it("painel do dia usa portfolio.settled e ignora posições abertas/indicativo", () => {
    const model = pnlIndicatorModel(fixtureOffice({
      portfolio: {
        settled: { wins: 14, losses: 11, draws: 1, pnl: 0.48, trades: 26 },
        openPositions: [{ indicative: { indicativePnl: 99 } }],
        equityCurve: [],
      },
    }));
    expect(model.tone).toBe("POSITIVE");
    expect(model.text).toBe("+R$ 0,48");
    expect(model.wins).toBe(14);
    expect(model.losses).toBe(11);
    expect(model.draws).toBe(1);
    expect(model.trades).toBe(26);
    expect(model.winRate).toBeCloseTo(14 / 25, 6);
    expect(pnlIndicatorModel({ portfolio: { settled: { pnl: -3, wins: 0, losses: 3, draws: 0, trades: 3 } } }).tone).toBe("NEGATIVE");
    const empty = pnlIndicatorModel({});
    expect(empty.tone).toBe("EMPTY");
    expect(empty.text).toBe("—");
  });

  it("câmera: fit inteiro centraliza e zoom preserva o anchor", () => {
    const camera = new OfficeCamera();
    camera.setViewport(800, 600);
    camera.fit({ minX: -200, minY: -100, maxX: 200, maxY: 100, width: 400, height: 200 });
    expect(camera.zoom).toBe(2);
    const center = camera.worldToScreen({ x: 0, y: 0 });
    expect(center.x).toBeCloseTo(400, 5);
    expect(center.y).toBeCloseTo(300, 5);
    const anchor = { x: 123, y: 77 };
    const before = camera.screenToWorld(anchor);
    camera.zoomAt(anchor, 4, { minX: -100000, minY: -100000, maxX: 100000, maxY: 100000, width: 200000, height: 200000 });
    expect(camera.zoom).toBe(4);
    const after = camera.screenToWorld(anchor);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
    camera.zoomAt(anchor, 100, null);
    expect(camera.zoom).toBe(4);
  });
});

describe("OFFICE V2 — placa, supervisor e detalhe", () => {
  it("placa de madeira centraliza o texto entalhado e limita largura", () => {
    const layout = computePlateLayout("EUR/USD", { width: 56, height: 14 });
    expect(layout.textX).toBe(28);
    expect(layout.blockTop + layout.blockHeight / 2).toBeCloseTo(7, 5);
    const linesCenter = layout.lines[0].y + ((layout.lines.length - 1) * layout.lineHeight) / 2;
    expect(Math.abs(linesCenter - 7)).toBeLessThanOrEqual(0.001);
    for (const line of layout.lines) {
      expect(line.text.length * layout.charWidth).toBeLessThanOrEqual(layout.width - layout.paddingX * 2 + 0.001);
    }
    const long = computePlateLayout("EURUSD:NORMAL SESSION", { width: 56, height: 14 });
    expect(long.lines.length).toBeLessThanOrEqual(2);
  });

  it("supervisor cumpre WALK>STOP>OBSERVE>WAIT>WALK sem teleporte", () => {
    expect(SUPERVISOR_PATROL_LOOP).toEqual(["WALK", "STOP", "OBSERVE", "WAIT"]);
    const machine = new AgentStateMachine("WALK");
    expect(machine.transition("STOP")).toBe(true);
    expect(machine.transition("OBSERVE")).toBe(true);
    expect(machine.transition("WAIT")).toBe(true);
    expect(machine.transition("WALK")).toBe(true);
    expect(machine.history).toEqual(["WALK", "STOP", "OBSERVE", "WAIT", "WALK"]);
    const patrol = new SupervisorPatrol({ speed: 4 });
    patrol.setPath([{ x: 0, y: 0 }, { x: 2, y: 0 }]);
    patrol.update(100, 0);
    expect(patrol.stage).toBe("WALK");
    expect(patrol.pos.x).toBeCloseTo(0.4, 5);
    patrol.update(1000, 0);
    expect(patrol.stage).toBe("STOP");
    patrol.update(SUPERVISOR_STAGE_MS.STOP, 0);
    expect(patrol.stage).toBe("OBSERVE");
    patrol.update(SUPERVISOR_STAGE_MS.OBSERVE, 0);
    expect(patrol.stage).toBe("WAIT");
    patrol.update(SUPERVISOR_STAGE_MS.WAIT, 0);
    expect(patrol.stage).toBe("WALK");
    expect(patrol.needsPath()).toBe(true);
  });

  it("painel de detalhe preenche lacunas com — sem inventar dados", () => {
    const rows = marketDetailRows({ marketKey: "EURUSD:NORMAL", display: "EUR/USD" });
    const values = rows.filter((row: any) => row.label).map((row: any) => row.value);
    expect(values).toContain("EUR/USD");
    expect(values).toContain("—");
    expect(rows.some((row: any) => row.label === "RSI14" && row.value === "—")).toBe(true);
    expect(rows.some((row: any) => row.label === "Nome IQ" && row.value === "—")).toBe(true);
  });
});

describe("OFFICE V2 — fitas de setor, pilhas laterais e badges", () => {
  it("mapeia cada família para a banda de referência com split esquerda/direita", () => {
    expect(sectorBand("OTC_24H")).toEqual({ bandId: "BAND_OTC_CRYPTO", side: "left", label: "OTC - 24H" });
    expect(sectorBand("CRYPTO")).toEqual({ bandId: "BAND_OTC_CRYPTO", side: "right", label: "CRIPTOMOEDAS" });
    expect(sectorBand("INDICES")).toEqual({ bandId: "BAND_INDICES_COMMODITIES", side: "left", label: "ÍNDICES" });
    expect(sectorBand("COMMODITIES")).toEqual({ bandId: "BAND_INDICES_COMMODITIES", side: "right", label: "COMMODITIES" });
    expect(sectorBand("FOREX_MAJORS").side).toBe("full");
    expect(sectorBand("OTHER").side).toBe("full");
  });

  it("os rótulos das fitas batem exatamente com a referência", () => {
    const expected = ["FOREX MAJORS", "FOREX CRUZADOS", "OTC - 24H", "CRIPTOMOEDAS", "ÍNDICES", "COMMODITIES", "OUTROS ATIVOS"];
    expect(SECTOR_RIBBON_LABELS).toEqual(expected);
    expect(new Set(SECTOR_RIBBON_LABELS).size).toBe(expected.length);
  });

  it("sectorRibbonBands agrupa OTC+CRIPTO e ÍNDICES+COMMODITIES em metades contíguas", () => {
    const layout = planStationLayout(fixtureMarkets());
    const bands = sectorRibbonBands(layout.sectors);
    const otcCrypto = bands.find((band: any) => band.id === "BAND_OTC_CRYPTO");
    expect(otcCrypto.split).toBe(true);
    expect(otcCrypto.members.map((member: any) => member.side)).toEqual(["left", "right"]);
    expect(otcCrypto.leftHalf.w).toBeGreaterThan(0);
    expect(otcCrypto.rightHalf.w).toBeGreaterThan(0);
    expect(otcCrypto.leftHalf.x + otcCrypto.leftHalf.w).toBeCloseTo(otcCrypto.rightHalf.x, 6);
    expect(otcCrypto.rows.length).toBeGreaterThan(0);
    const idxComm = bands.find((band: any) => band.id === "BAND_INDICES_COMMODITIES");
    expect(idxComm.split).toBe(true);
    expect(idxComm.members.map((member: any) => member.side)).toEqual(["left", "right"]);
    const full = bands.find((band: any) => band.id === "BAND_FOREX_MAJORS");
    expect(full.split).toBe(false);
    expect(full.members).toHaveLength(1);
  });

  it("badge flutuante de P&L só aparece em resultado liquidado e mesa ativa", () => {
    const win = deskBadgeModel({ enabled: true, availability: "OPEN", settlementState: { lastResult: "WIN", lastProfit: 1.7 } });
    expect(win.visible).toBe(true);
    expect(win.tone).toBe("POSITIVE");
    expect(win.color).toBe("#4fbf6a");
    expect(win.text.startsWith("+R$")).toBe(true);
    const loss = deskBadgeModel({ enabled: true, availability: "OPEN", settlementState: { lastResult: "LOSS", lastProfit: -2 } });
    expect(loss.visible).toBe(true);
    expect(loss.tone).toBe("NEGATIVE");
    const draw = deskBadgeModel({ enabled: true, availability: "OPEN", settlementState: { lastResult: "DRAW", lastProfit: 0 } });
    expect(draw.visible).toBe(true);
    expect(draw.text).toBe("R$ 0,00");
    const indicative = deskBadgeModel({ enabled: true, availability: "OPEN", positionState: { status: "OPEN" }, indicative: { state: "FAVORABLE", indicativePnl: 9.9 } });
    expect(indicative.visible).toBe(false);
    expect(indicative.tone).toBe("NONE");
  });

  it("mesa vazia (não-OPEN/desabilitada) não mostra badge nem agentes", () => {
    expect(isDeskActive({ enabled: true, availability: "OPEN" })).toBe(true);
    expect(isDeskActive({ enabled: false, availability: "OPEN" })).toBe(false);
    expect(isDeskActive({ enabled: true, availability: "CLOSED" })).toBe(false);
    expect(isDeskActive({ enabled: true, availability: "SUSPENDED" })).toBe(false);
    expect(isDeskActive({ enabled: true, availability: "NOT_OFFERED" })).toBe(false);
    expect(isDeskActive({ enabled: true, availability: "UNKNOWN" })).toBe(false);
    const settledButClosed = deskBadgeModel({ enabled: true, availability: "CLOSED", settlementState: { lastResult: "WIN", lastProfit: 5 } });
    expect(settledButClosed.visible).toBe(false);
    expect(settledButClosed.active).toBe(false);
    const markets = fixtureMarkets();
    markets[0] = { ...markets[0], availability: "CLOSED", enabled: false, settlementState: { lastResult: "WIN", lastProfit: 5 } };
    const world = new OfficeWorld(fixtureOffice({ markets }));
    const station = world.stations[0];
    expect(station.market.availability).toBe("CLOSED");
    expect(station.trader.state).toBe("OFFLINE");
    expect(station.critic.state).toBe("OFFLINE");
  });

  it("quadro do dia expõe abertos/fechados/total e lucro semanal/mensal (— quando ausente)", () => {
    const model = pnlIndicatorModel(fixtureOffice({
      portfolio: {
        settled: { wins: 16, losses: 5, draws: 0, pnl: 578.76, trades: 21 },
        weekly: { pnl: 1842.3 },
        monthly: { pnl: 6721.55 },
        equityCurve: [],
      },
    }));
    expect(model.openMarkets).toBe(55);
    expect(model.closedMarkets).toBe(0);
    expect(model.totalMarkets).toBe(55);
    expect(model.weeklyText).toBe("+R$ 1.842,30");
    expect(model.monthlyText).toBe("+R$ 6.721,55");
    expect(model.winRateText).toBe("76.2%");
    const absent = pnlIndicatorModel({ portfolio: { settled: { pnl: 0, wins: 0, losses: 0, draws: 0, trades: 0 } } });
    expect(absent.weeklyText).toBe("—");
    expect(absent.monthlyText).toBe("—");
  });

  it("maior win/loss vêm apenas de resultados liquidados reais", () => {
    const model = pnlIndicatorModel(fixtureOffice({
      markets: [
        { marketKey: "A", enabled: true, availability: "OPEN", settlementState: { lastResult: "WIN", lastProfit: 24.5 } },
        { marketKey: "B", enabled: true, availability: "OPEN", settlementState: { lastResult: "WIN", lastProfit: 8.5 } },
        { marketKey: "C", enabled: true, availability: "OPEN", settlementState: { lastResult: "LOSS", lastProfit: -10 } },
        { marketKey: "D", enabled: true, availability: "OPEN", positionState: { status: "OPEN" }, indicative: { indicativePnl: 99 } },
      ],
    }));
    expect(model.bestWinText).toBe("+R$ 24,50");
    expect(model.bestLossText).toBe("-R$ 10,00");
    expect(pnlIndicatorModel({}).bestWinText).toBe("—");
  });

  it("pilhas laterais trazem os títulos e subtítulos da referência", () => {
    const leftTitles = SIDE_PANELS.left.map((panel: any) => panel.title);
    expect(leftTitles).toContain("TRACE/COM");
    expect(leftTitles).toContain("PROFESSOR & PESQUISA");
    expect(leftTitles).toContain("SALA DE REUNIÃO");
    expect(leftTitles).toContain("DATA CENTER");
    expect(SIDE_PANELS.left.some((panel: any) => String(panel.subtitle).includes("DISCIPLINA · DADOS · RESULTADOS"))).toBe(true);
    expect(SIDE_PANELS.left.some((panel: any) => String(panel.subtitle).includes("DADOS TESTES APRENDIZADO EVOLUÇÃO"))).toBe(true);
    expect(SIDE_PANELS.left.some((panel: any) => String(panel.subtitle).includes("ESTABILIDADE CONEXÃO EXECUÇÃO SEM INTERRUPÇÕES"))).toBe(true);
    const rightTitles = SIDE_PANELS.right.map((panel: any) => panel.title);
    expect(rightTitles).toContain("DISCIPLINA TRANSFORMA ESTRATÉGIA EM LIBERDADE");
    expect(rightTitles).toContain("PAUSA TAMBÉM É ESTRATÉGIA");
    expect(rightTitles).toContain("ÁREA DE LAZER");
    expect(rightTitles).toContain("COZINHA");
    expect(rightTitles).toContain("TERRAÇO");
    expect(SIDE_PANELS.right.some((panel: any) => String(panel.subtitle).includes("sinuca videogame conversa"))).toBe(true);
    expect(SIDE_PANELS.right.some((panel: any) => String(panel.subtitle).includes("café energia disciplina bom humor"))).toBe(true);
    expect(SIDE_PANELS.right.some((panel: any) => String(panel.subtitle).includes("RESPIRA ANALISA DECIDE MELHOR"))).toBe(true);
  });
});
