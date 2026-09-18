/**
 * PROFESSOR + JOURNAL + HYPOTHESES (Fase 6)
 *
 * - PROFESSOR: avalia a QUALIDADE da decisao usando o snapshot t0 (antes do resultado), depois compara
 *   com o outcome. Pode existir GOOD_DECISION+LOSS e BAD_DECISION+WIN.
 * - JOURNAL: registra cada trade com o snapshot estruturado completo; gera memoria por agente e relatorio diario.
 * - HYPOTHESES: padroes observados viram HIPOTESE (nunca regra); promocao para VALIDATED_KNOWLEDGE
 *   somente com evidencia prospectiva e Gate; escrita no vault respeita o Promotion Gate.
 */
export const PROFESSOR_VERSION = "trade-professor-v1";
export const JOURNAL_VERSION = "trade-journal-v1";
export const HYPOTHESIS_VERSION = "hypothesis-registry-v1";

export const DECISION_QUALITIES = ["GOOD_DECISION", "ACCEPTABLE_DECISION", "BAD_DECISION"];

/* ------------------------------------ PROFESSOR ------------------------------------ */

export function reviewTrade({ snapshot, outcome, result }) {
  const mistakes = [];
  const strengths = [];
  const setup = snapshot?.setup ?? "NO_VALID_SETUP";
  const regime = snapshot?.regime ?? "UNCLEAR";
  const action = snapshot?.action ?? "WAIT";
  const contradictions = snapshot?.contradictingEvidence ?? [];
  const extension = Math.max(snapshot?.location?.distanceToUpperATR ?? 0, snapshot?.location?.distanceToLowerATR ?? 0);
  const trigger = snapshot?.trigger ?? null;
  if (action !== "WAIT") {
    if (!trigger) mistakes.push({ code: "ENTRADA_SEM_TRIGGER", detail: "acao sem trigger explicito" });
    if (["CHAOTIC", "UNCLEAR"].includes(regime)) mistakes.push({ code: "REGIME_INADEQUADO", detail: `entrou em ${regime}` });
    if (setup === "NO_VALID_SETUP") mistakes.push({ code: "SEM_SETUP", detail: "entrou sem setup valido" });
    if (extension > 2.5) mistakes.push({ code: "ENTRADA_ATRASADA", detail: `extensao ${extension.toFixed(2)} ATR do canal` });
    if (contradictions.some((code) => ["forca_caindo", "regime_chaotic", "regime_unclear"].includes(code))) mistakes.push({ code: "CONTRAEVIDENCIA_IGNORADA", detail: contradictions[0] });
    if ((snapshot?.momentum?.acceleration ?? 0) !== 0 && Math.sign(snapshot.momentum.acceleration) !== (action === "BUY" ? 1 : -1)) mistakes.push({ code: "MOMENTUM_CONTRA", detail: "aceleracao contra a entrada" });
    if (!mistakes.length) strengths.push({ code: "PROCESSO_OK", detail: `${setup} em ${regime} com trigger ${trigger}` });
    if ((snapshot?.analysisConfidence ?? 0) >= 0.6 && (snapshot?.processLog ?? []).every((entry) => entry.status !== "FAIL")) strengths.push({ code: "CONFIANCA_SUPORTADA", detail: "todos os estagios OK" });
  } else {
    strengths.push({ code: "WAIT_DISCIPLINADO", detail: snapshot?.waitReason ?? "sem setup" });
  }
  const wouldWaitBeBetter = mistakes.length > 0 && (result === "LOSS" || extension > 2.5);
  const decisionQuality = mistakes.some((mistake) => ["REGIME_INADEQUADO", "SEM_SETUP", "ENTRADA_SEM_TRIGGER"].includes(mistake.code)) ? "BAD_DECISION" : mistakes.length ? "ACCEPTABLE_DECISION" : "GOOD_DECISION";
  const lesson = mistakes.length
    ? { code: "LESSON", text: `Evitar ${mistakes[0].code} em ${snapshot?.marketKey}: ${mistakes[0].detail}.`, focus: mistakes[0].code }
    : action === "WAIT" ? { code: "GOOD_WAIT", text: `WAIT correto em ${snapshot?.marketKey} (${snapshot?.waitReason ?? "sem setup"}).`, focus: "DISCIPLINA" }
    : { code: "GOOD_DECISION", text: `Processo correto em ${snapshot?.marketKey} (${setup}).`, focus: setup };
  return {
    version: PROFESSOR_VERSION, at: Date.now(), marketKey: snapshot?.marketKey ?? null, action, setup, regime,
    outcome: result ?? outcome ?? "UNKNOWN", decisionQuality, outcomeVsQuality: `${decisionQuality}+${result ?? outcome ?? "UNKNOWN"}`,
    mistakes, strengths, wouldWaitBeBetter, lesson,
    snapshotAtDecision: { regime, setup, trigger, location: snapshot?.location ?? null, momentum: snapshot?.momentum ?? null, strength: snapshot?.strength ?? null, volatility: snapshot?.volatility ?? null, contradictions },
    note: "Qualidade avaliada pelo snapshot t0 (antes do resultado); o outcome nao define a qualidade.",
  };
}

/* ------------------------------------ JOURNAL ------------------------------------ */

const emptyStats = () => ({ trades: 0, wins: 0, losses: 0, draws: 0, pnl: 0, goodDecisions: 0, badDecisions: 0, goodDecisionLosses: 0, badDecisionWins: 0, bySetup: {}, byRegime: {}, waitCount: 0 });

export class TradingJournal {
  constructor({ pool = null, now = () => Date.now(), secondBrain = null, log = () => {} } = {}) {
    this.pool = pool;
    this.now = now;
    this.secondBrain = secondBrain;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.trades = [];
    this.decisions = [];
    this.agentStats = new Map(); // agentId -> stats
    this.daily = new Map(); // YYYY-MM-DD -> stats
    this.dbReady = null;
    this.journalDecisionSourceColumn = null;
  }

  #agent(agentId) { if (!this.agentStats.has(agentId)) this.agentStats.set(agentId, emptyStats()); return this.agentStats.get(agentId); }

  recordDecision({ agentId, marketKey, marketType, decisionAt, snapshot, review = null }) {
    const record = { agentId, marketKey, marketType, decisionAt, setup: snapshot?.setup ?? null, regime: snapshot?.regime ?? null, action: snapshot?.action ?? "WAIT", waitReason: snapshot?.waitReason ?? null, knowledgeContextIds: snapshot?.knowledgeContextIds ?? [], review };
    this.decisions.push(record);
    if (this.decisions.length > 5000) this.decisions.splice(0, this.decisions.length - 5000);
    if (record.action === "WAIT") this.#agent(agentId).waitCount += 1;
    return record;
  }

  /** Journal estruturado pos-settlement (Parte R). Persiste em Postgres (fonte de verdade) + espelho no vault. */
  async recordTrade(entry) {
    const record = {
      version: JOURNAL_VERSION,
      tradeId: entry.tradeId ?? null, decisionId: entry.decisionId ?? null, correlationId: entry.correlationId ?? null,
      agentId: entry.agentId ?? null, marketKey: entry.marketKey ?? null, marketType: entry.marketType ?? null,
      entryAt: entry.entryAt ?? null, settlementAt: entry.settlementAt ?? this.now(), payout: entry.payout ?? null, stake: entry.stake ?? null,
      direction: entry.direction ?? null, result: entry.result ?? "UNKNOWN",
      regime: entry.snapshot?.regime ?? null, structure: entry.snapshot?.structure?.label ?? null, location: entry.snapshot?.location?.zone ?? null,
      indicators: { rsi14: entry.snapshot?.momentum?.rsi14 ?? null, adx14: entry.snapshot?.strength?.adx14 ?? null, atrRatio: entry.snapshot?.volatility?.atrRatio ?? null },
      setup: entry.snapshot?.setup ?? null, trigger: entry.snapshot?.trigger ?? null,
      supportingEvidence: entry.snapshot?.supportingEvidence ?? [], contradictingEvidence: entry.snapshot?.contradictingEvidence ?? [],
      traderDecision: entry.snapshot?.action ?? null, criticDecision: entry.snapshot?.critic ?? null, consensus: entry.snapshot?.consensus ?? null,
      decisionSource: entry.snapshot?.decisionSource ?? entry.decisionSource ?? null,
      brainDecision: entry.snapshot?.brainDecision ?? entry.snapshot?.action ?? null,
      manualRequestedDirection: entry.snapshot?.manualRequestedDirection ?? null,
      intelligence: entry.intelligence ?? null, knowledgeContextIds: entry.snapshot?.knowledgeContextIds ?? [], knowledgeVersion: entry.snapshot?.knowledgeVersion ?? null,
      outcome: entry.result ?? "UNKNOWN", decisionQuality: entry.review?.decisionQuality ?? "UNKNOWN", review: entry.review ?? null,
      snapshot: entry.snapshot ?? null, snapshotSource: entry.snapshot?.source ?? "SETTLEMENT_FALLBACK",
      initialSnapshot: entry.initialSnapshot ?? null, initialReview: entry.initialReview ?? null, entryTiming: entry.entryTiming ?? null,
      createdAt: this.now(),
    };
    this.trades.push(record);
    if (this.trades.length > 5000) this.trades.splice(0, this.trades.length - 5000);
    const agent = this.#agent(record.agentId ?? `trader:${record.marketKey}`);
    agent.trades += 1; agent.pnl = Number((agent.pnl + (Number(entry.profit) || 0)).toFixed(4));
    if (record.result === "WIN") agent.wins += 1; else if (record.result === "LOSS") agent.losses += 1; else agent.draws += 1;
    if (record.decisionQuality === "GOOD_DECISION") agent.goodDecisions += 1;
    if (record.decisionQuality === "BAD_DECISION") agent.badDecisions += 1;
    if (record.decisionQuality === "GOOD_DECISION" && record.result === "LOSS") agent.goodDecisionLosses += 1;
    if (record.decisionQuality === "BAD_DECISION" && record.result === "WIN") agent.badDecisionWins += 1;
    agent.bySetup[record.setup ?? "NO_VALID_SETUP"] = (agent.bySetup[record.setup ?? "NO_VALID_SETUP"] ?? 0) + 1;
    agent.byRegime[record.regime ?? "UNCLEAR"] = (agent.byRegime[record.regime ?? "UNCLEAR"] ?? 0) + 1;
    void this.#persist(record);
    void this.#mirror(record);
    return record;
  }

  async #persist(record) {
    try {
      if (!this.pool) return false;
      if (this.dbReady === null) { const result = await this.pool.query("SELECT to_regclass('public.iq_trade_journal') AS table_name"); this.dbReady = Boolean(result.rows[0]?.table_name); }
      if (!this.dbReady) return false;
      const baseColumns = "trade_id,decision_id,correlation_id,agent_id,market_key,market_type,entry_at,settlement_at,payout,stake,direction,result,regime,structure,location,setup,trigger,trader_decision,critic_decision,consensus,outcome,decision_quality,payload,created_at";
      const baseValues = "VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),to_timestamp($8/1000.0),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20::jsonb,$21,$22,$23::jsonb,now())";
      const baseParams = [record.tradeId ?? `journal_${record.settlementAt}_${record.marketKey}`, record.decisionId, record.correlationId, record.agentId, record.marketKey, record.marketType, record.entryAt ?? record.settlementAt, record.settlementAt, record.payout, record.stake, record.direction, record.result, record.regime, record.structure, record.location, record.setup, record.trigger, JSON.stringify(record.traderDecision), JSON.stringify(record.criticDecision), JSON.stringify(record.consensus), record.outcome, record.decisionQuality, JSON.stringify(record)];
      if (this.journalDecisionSourceColumn !== false) {
        try {
          await this.pool.query(
            `INSERT INTO iq_trade_journal(${baseColumns},decision_source,brain_decision,manual_requested_direction) VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),to_timestamp($8/1000.0),$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,$20::jsonb,$21,$22,$23::jsonb,now(),$24,$25,$26) ON CONFLICT(trade_id) DO NOTHING`,
            [...baseParams, record.decisionSource, record.brainDecision, record.manualRequestedDirection],
          );
          this.journalDecisionSourceColumn = true;
          return true;
        } catch (error) {
          if (String(error?.code) !== "42703") throw error;
          this.journalDecisionSourceColumn = false;
        }
      }
      await this.pool.query(`INSERT INTO iq_trade_journal(${baseColumns}) ${baseValues} ON CONFLICT(trade_id) DO NOTHING`, baseParams);
      return true;
    } catch (error) { this.log("IQ_JOURNAL_PERSIST_FAILED", String(error?.message ?? error).slice(0, 120)); return false; }
  }

  async #mirror(record) {
    if (!this.secondBrain || this.secondBrain.mode === "OFFLINE") return;
    const day = new Date(record.settlementAt).toISOString().slice(0, 10);
    const agentFolder = String(record.marketKey ?? "UNKNOWN").replaceAll(":", "-").toUpperCase();
    const line = `| ${new Date(record.settlementAt).toISOString()} | ${record.direction} | ${record.stake} | ${record.result} | ${record.decisionQuality} | ${record.setup ?? "—"} | ${record.regime ?? "—"} | ${record.contradictingEvidence?.join(", ") || "—"} |\n`;
    const header = "| at | dir | stake | result | quality | setup | regime | contradicting |\n|---|---|---|---|---|---|---|---|\n";
    const existing = await this.secondBrain.readNote(`TraceCom/11 - Trade Journal/${agentFolder}/${day}.md`).catch(() => null);
    await this.secondBrain.writeNote(`TraceCom/11 - Trade Journal/${agentFolder}/${day}.md`, existing ? `${existing}${line}` : `${header}${line}`).catch(() => undefined);
    await this.#mirrorAgentMemory(record, agentFolder);
  }

  async #mirrorAgentMemory(record, agentFolder) {
    const agentId = record.agentId ?? `trader:${record.marketKey}`;
    const stats = this.#agent(agentId);
    const decided = stats.wins + stats.losses + stats.draws;
    const profile = `---\ntitle: ${agentId}\ncategory: AGENT_MEMORY\nstatus: AGENT_MEMORY\nagentId: ${agentId}\nknowledgeVersion: ${record.knowledgeVersion ?? "—"}\navailableAt: ${this.now()}\n---\n\n# ${agentId}\n\n- trades: ${stats.trades}\n- W/L/D: ${stats.wins}/${stats.losses}/${stats.draws}\n- WR: ${decided ? ((stats.wins / decided) * 100).toFixed(1) : "—"}%\n- PnL: ${stats.pnl}\n- decisoes boas: ${stats.goodDecisions} · ruins: ${stats.badDecisions}\n- GOOD_DECISION+LOSS: ${stats.goodDecisionLosses} · BAD_DECISION+WIN: ${stats.badDecisionWins}\n`;
    await this.secondBrain.writeNote(`TraceCom/10 - Agents/${agentFolder}/Profile.md`, profile).catch(() => undefined);
    const lessons = this.trades.filter((trade) => trade.agentId === agentId && trade.review?.lesson).slice(-20).map((trade) => `- [${new Date(trade.settlementAt).toISOString().slice(0, 10)}] ${trade.review.lesson.text}`).join("\n");
    if (lessons) await this.secondBrain.writeNote(`TraceCom/10 - Agents/${agentFolder}/Lessons.md`, `---\ntitle: Lessons ${agentId}\ncategory: AGENT_MEMORY\nstatus: AGENT_MEMORY\n---\n\n${lessons}\n`).catch(() => undefined);
    const mistakes = this.trades.filter((trade) => trade.agentId === agentId && (trade.review?.mistakes ?? []).length).slice(-20).flatMap((trade) => trade.review.mistakes.map((mistake) => `- ${mistake.code}: ${mistake.detail}`)).join("\n");
    if (mistakes) await this.secondBrain.writeNote(`TraceCom/10 - Agents/${agentFolder}/Mistakes.md`, `---\ntitle: Mistakes ${agentId}\ncategory: AGENT_MEMORY\nstatus: AGENT_MEMORY\n---\n\n${mistakes}\n`).catch(() => undefined);
  }

  agentMemory(agentId) {
    const stats = this.#agent(agentId);
    const trades = this.trades.filter((trade) => trade.agentId === agentId);
    const decided = stats.wins + stats.losses + stats.draws;
    return { agentId, stats: { ...stats, winRate: decided ? Number((stats.wins / decided).toFixed(4)) : null }, trades: trades.slice(-50), lessons: trades.filter((trade) => trade.review?.lesson).slice(-20).map((trade) => trade.review.lesson), mistakes: trades.flatMap((trade) => trade.review?.mistakes ?? []).slice(-30) };
  }

  dailyReport(date = new Date(this.now()).toISOString().slice(0, 10)) {
    const trades = this.trades.filter((trade) => new Date(trade.settlementAt).toISOString().slice(0, 10) === date);
    const wins = trades.filter((trade) => trade.result === "WIN").length;
    const losses = trades.filter((trade) => trade.result === "LOSS").length;
    const draws = trades.filter((trade) => trade.result === "DRAW").length;
    const decided = wins + losses + draws;
    const byMarket = {}, bySetup = {}, byRegime = {}, byAgent = {};
    for (const trade of trades) {
      const bucket = (map, key) => { map[key] = map[key] ?? { trades: 0, wins: 0, losses: 0, pnl: 0 }; map[key].trades += 1; if (trade.result === "WIN") map[key].wins += 1; if (trade.result === "LOSS") map[key].losses += 1; map[key].pnl = Number((map[key].pnl + (trade.review?.outcome === "WIN" ? 1 : 0)).toFixed(4)); };
      bucket(byMarket, trade.marketKey ?? "UNKNOWN"); bucket(bySetup, trade.setup ?? "NO_VALID_SETUP"); bucket(byRegime, trade.regime ?? "UNCLEAR"); bucket(byAgent, trade.agentId ?? "UNKNOWN");
    }
    const decisions = this.decisions.filter((decision) => new Date(decision.decisionAt).toISOString().slice(0, 10) === date);
    return {
      date, version: JOURNAL_VERSION, trades: trades.length, wins, losses, draws, winRate: decided ? Number((wins / decided).toFixed(4)) : null,
      avgPayout: trades.length ? Number((trades.reduce((sum, trade) => sum + (Number(trade.payout) || 0), 0) / trades.length).toFixed(2)) : null,
      practicePnl: Number(trades.reduce((sum, trade) => sum + (trade.result === "WIN" ? (Number(trade.stake) || 0) * ((Number(trade.payout) || 0) / 100) : trade.result === "LOSS" ? -(Number(trade.stake) || 0) : 0), 0).toFixed(4)),
      byMarket, bySetup, byRegime, byAgent,
      waits: decisions.filter((decision) => decision.action === "WAIT").length,
      blockedDecisions: decisions.filter((decision) => decision.review?.blocked).length,
      goodDecisions: trades.filter((trade) => trade.decisionQuality === "GOOD_DECISION").length,
      badDecisions: trades.filter((trade) => trade.decisionQuality === "BAD_DECISION").length,
      goodDecisionLosses: trades.filter((trade) => trade.decisionQuality === "GOOD_DECISION" && trade.result === "LOSS").length,
      badDecisionWins: trades.filter((trade) => trade.decisionQuality === "BAD_DECISION" && trade.result === "WIN").length,
      lessons: trades.map((trade) => trade.review?.lesson?.text).filter(Boolean),
      smallSampleWarning: decided < 30 ? "AMOSTRA PEQUENA — nao tratar como vantagem comprovada" : null,
    };
  }

  async writeDailyReport(date = new Date(this.now()).toISOString().slice(0, 10)) {
    const report = this.dailyReport(date);
    const markdown = `---\ntitle: Daily Report ${date}\ncategory: DAILY_REPORT\nstatus: AGENT_MEMORY\navailableAt: ${this.now()}\n---\n\n# Relatorio diario ${date}\n\n- trades: ${report.trades} · W/L/D: ${report.wins}/${report.losses}/${report.draws} · WR: ${report.winRate ?? "—"}\n- payout medio: ${report.avgPayout ?? "—"} · PnL PRACTICE: ${report.practicePnl}\n- WAITs: ${report.waits} · decisoes boas: ${report.goodDecisions} · ruins: ${report.badDecisions}\n- GOOD_DECISION+LOSS: ${report.goodDecisionLosses} · BAD_DECISION+WIN: ${report.badDecisionWins}\n${report.smallSampleWarning ? `- ATENCAO: ${report.smallSampleWarning}\n` : ""}\n## Por mercado\n${Object.entries(report.byMarket).map(([key, value]) => `- ${key}: ${value.trades} trades · W ${value.wins} L ${value.losses}`).join("\n") || "- sem trades"}\n\n## Por setup\n${Object.entries(report.bySetup).map(([key, value]) => `- ${key}: ${value.trades} trades`).join("\n") || "- sem trades"}\n\n## Licoes\n${report.lessons.slice(0, 10).map((lesson) => `- ${lesson}`).join("\n") || "- sem licoes"}\n`;
    if (this.secondBrain && this.secondBrain.mode !== "OFFLINE") await this.secondBrain.writeNote(`TraceCom/12 - Daily Reports/${date}.md`, markdown).catch(() => undefined);
    return { report, markdown };
  }
}

/* ------------------------------------ HYPOTHESES ------------------------------------ */

export const HYPOTHESIS_DEFAULTS = { minSamples: 30, minPerformanceDelta: 0.10, maxDrawdown: 8, requireProspective: true };
export const HYPOTHESIS_STATES = ["CANDIDATE", "TESTING", "SUPPORTED", "REJECTED", "PROMOTED"];

export class HypothesisRegistry {
  constructor({ now = () => Date.now(), config = {}, secondBrain = null, log = () => {} } = {}) {
    this.now = now;
    this.config = { ...HYPOTHESIS_DEFAULTS, ...config };
    this.secondBrain = secondBrain;
    this.items = new Map();
    this.sequence = 0;
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
  }

  create({ originAgent, marketKey, statement, observedEffect = null, sample = 0, markets = [], evidenceIds = [], regime = null, setup = null }) {
    if (!statement) throw new Error("HYPOTHESIS_STATEMENT_REQUIRED");
    const id = `hyp_${++this.sequence}_${this.now()}`;
    const item = { id, version: HYPOTHESIS_VERSION, originAgent: originAgent ?? "unknown", marketKey: marketKey ?? null, statement: String(statement).slice(0, 300), observedEffect, sample, markets, evidenceIds, regime, setup, state: "CANDIDATE", createdAt: this.now(), availableAt: this.now(), prospective: { samples: 0, wins: 0, losses: 0, pnl: 0 } };
    this.items.set(id, item);
    void this.#write(item, "14 - Hypotheses");
    void this.#audit("HYPOTHESIS_CREATED", item);
    return item;
  }

  observe(id, { result, pnl = 0 }) {
    const item = this.items.get(id);
    if (!item) return null;
    item.state = "TESTING";
    item.prospective.samples += 1;
    if (result === "WIN") item.prospective.wins += 1; else if (result === "LOSS") item.prospective.losses += 1;
    item.prospective.pnl = Number((item.prospective.pnl + (Number(pnl) || 0)).toFixed(4));
    return item;
  }

  /** Promotion Gate: somente evidencia prospectiva suficiente promove para VALIDATED_KNOWLEDGE. */
  evaluate(id) {
    const item = this.items.get(id);
    if (!item) return null;
    const decided = item.prospective.wins + item.prospective.losses;
    const pnlPerTrade = decided ? item.prospective.pnl / decided : null;
    const eligible = decided >= this.config.minSamples && pnlPerTrade !== null && pnlPerTrade >= this.config.minPerformanceDelta;
    const decision = eligible ? "PROMOTE" : decided >= this.config.minSamples ? "REJECT" : "HOLD";
    const evaluation = { id, at: this.now(), decision, decided, minSamples: this.config.minSamples, pnlPerTrade, prospective: item.prospective };
    if (decision === "PROMOTE") { item.state = "PROMOTED"; item.promotedAt = this.now(); void this.#write(item, "15 - Validated Knowledge", { promotion: true }); void this.#audit("HYPOTHESIS_PROMOTED", item); }
    else if (decision === "REJECT") { item.state = "REJECTED"; void this.#audit("HYPOTHESIS_REJECTED", item); }
    return evaluation;
  }

  list() { return [...this.items.values()].sort((a, b) => b.createdAt - a.createdAt); }

  async #write(item, folder, { promotion = false } = {}) {
    if (!this.secondBrain || this.secondBrain.mode === "OFFLINE") return;
    const markdown = `---\ntitle: ${item.id}\ncategory: HYPOTHESIS\noriginAgent: ${item.originAgent}\nmarketKey: ${item.marketKey ?? "—"}\nregime: ${item.regime ?? "—"}\nsetup: ${item.setup ?? "—"}\nstatus: ${item.state === "PROMOTED" ? "VALIDATED_KNOWLEDGE" : "CANDIDATE_KNOWLEDGE"}\navailableAt: ${item.availableAt}\nsample: ${item.sample}\n---\n\n# ${item.statement}\n\n- efeito observado: ${item.observedEffect ?? "—"}\n- amostra inicial: ${item.sample}\n- mercados: ${(item.markets ?? []).join(", ") || "—"}\n- evidencia: ${(item.evidenceIds ?? []).join(", ") || "—"}\n- prospectivo: ${JSON.stringify(item.prospective)}\n`;
    await this.secondBrain.writeNote(`TraceCom/${folder}/${item.id}.md`, markdown, { promotion }).catch(() => undefined);
  }

  async #audit(event, item) { this.log("IQ_HYPOTHESIS", JSON.stringify({ event, id: item.id, state: item.state })); }
}

/* ------------------------------------ SUPERVISOR ------------------------------------ */

export const SUPERVISOR_VERSION = "performance-supervisor-v1";
export const SUPERVISOR_DEFAULTS = { minSamples: 20, maxDrawdown: 8, maxConsecutiveLosses: 6, minDecisionQuality: 0.5, reviewCooldownMs: 30 * 60_000 };

export class PerformanceSupervisor {
  constructor({ now = () => Date.now(), config = {}, log = () => {} } = {}) {
    this.now = now;
    this.config = { ...SUPERVISOR_DEFAULTS, ...config };
    this.reviews = [];
    this.sequence = 0;
    this.lastReviewAt = new Map();
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
  }

  /** Monitora agente/marketKey/setup/regime e solicita REVIEW_REQUIRED ao Professor/Research. Nunca troca metodologia. */
  evaluate({ agentId, marketKey, stats, review }) {
    const reasons = [];
    const decided = (stats?.wins ?? 0) + (stats?.losses ?? 0) + (stats?.draws ?? 0);
    if (decided >= this.config.minSamples) {
      if ((stats?.pnl ?? 0) < -this.config.maxDrawdown) reasons.push("DRAWDOWN_EXCEDIDO");
      const quality = stats?.goodDecisions !== undefined && decided ? stats.goodDecisions / Math.max(1, stats.goodDecisions + (stats.badDecisions ?? 0)) : null;
      if (quality !== null && quality < this.config.minDecisionQuality) reasons.push("QUALIDADE_DECISORIA_BAIXA");
      if ((stats?.consecutiveLosses ?? 0) >= this.config.maxConsecutiveLosses) reasons.push("SEQUENCIA_DE_PERDAS");
      if ((stats?.badDecisionWins ?? 0) > 0 && (stats?.goodDecisionLosses ?? 0) === 0 && decided >= this.config.minSamples * 2) reasons.push("RESULTADO_POR_SORTE");
    }
    const last = this.lastReviewAt.get(marketKey) ?? 0;
    const cooldownOk = this.now() - last >= this.config.reviewCooldownMs;
    const status = reasons.length && cooldownOk ? "REVIEW_REQUIRED" : reasons.length ? "REVIEW_PENDING_COOLDOWN" : "OK";
    const record = { id: ++this.sequence, at: this.now(), agentId, marketKey, status, reasons, stats: stats ? { trades: stats.trades, wins: stats.wins, losses: stats.losses, pnl: stats.pnl, goodDecisions: stats.goodDecisions, badDecisions: stats.badDecisions } : null, review: review ?? null };
    if (status === "REVIEW_REQUIRED") { this.lastReviewAt.set(marketKey, this.now()); void this.log("IQ_SUPERVISOR_REVIEW_REQUIRED", JSON.stringify({ agentId, marketKey, reasons })); }
    this.reviews.push(record);
    if (this.reviews.length > 500) this.reviews.splice(0, this.reviews.length - 500);
    return record;
  }

  status() {
    return { version: SUPERVISOR_VERSION, config: { ...this.config }, reviews: this.reviews.slice(-20).reverse(), note: "Monitora qualidade; NAO troca metodologia nem inventa estrategia." };
  }
  toJSON() { return { version: SUPERVISOR_VERSION, config: this.config, reviews: this.reviews.slice(-200), lastReviewAt: [...this.lastReviewAt.entries()] }; }
  loadFrom(snapshot) {
    if (!snapshot) return false;
    this.config = { ...this.config, ...(snapshot.config ?? {}) };
    this.reviews = Array.isArray(snapshot.reviews) ? snapshot.reviews.slice(-200) : [];
    for (const [key, value] of snapshot.lastReviewAt ?? []) this.lastReviewAt.set(key, value);
    return true;
  }
}
