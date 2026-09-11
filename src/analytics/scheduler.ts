/**
 * OutcomeScheduler — driver periódico que avalia outcomes pendentes.
 *
 * P-R: garante que `updateOutcome` é chamado periodicamente para decisões
 * cujo horizonte já decorreu, sem depender de chamada HTTP/CLI manual.
 *
 * Garantias:
 *  - Idempotência: rerodar o tick é seguro (updateOutcome é idempotente).
 *  - Sem lookahead: usa apenas candles com timestamp >= exitTime.
 *  - Smoke test: `runOnce()` pode ser chamado uma vez e parar.
 *  - Logs estruturados de cada run (evaluated, stalled, error).
 *  - Cleanup: stop() limpa o handle de setInterval.
 *
 * NÃO toca:
 *  - Calibration (P-A): fica para próximo round.
 *  - Bankroll/Kill switch (P-N): separado.
 *  - Provider/troca de arquitetura: estável.
 */
import type { AnalyticsService } from "./service";

export interface OutcomeSchedulerOptions {
  /** Intervalo em ms entre ticks. Default: 30000 (30s). */
  readonly intervalMs?: number;
  /** Provider ID ativo no momento (para log de auditoria). */
  readonly providerId?: string | null;
  /** Logger opcional (interface minimal). */
  readonly logger?: {
    info(msg: string, meta?: unknown): void;
    warn(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
}

export interface TickResult {
  readonly evaluated: number;
  readonly outcomes: { hit: number; miss: number; flat: number; pending: number; stalled: number; error: number };
  readonly shadowsEvaluated?: number;
  readonly durationMs: number;
  readonly ranAt: number;
}

export interface OutcomeScheduler {
  /** Inicia o loop. Idempotente — segunda chamada é no-op. */
  start(): void;
  /** Para o loop. Aguarda tick em curso se houver. */
  stop(): Promise<void>;
  /** Roda UM tick (para smoke test). Sempre retorna o resultado. */
  runOnce(opts?: { includeShadows?: boolean; shadowHorizonCandles?: number }): Promise<TickResult>;
  /** Indica se está rodando. */
  readonly running: boolean;
}

export function createOutcomeScheduler(
  analytics: AnalyticsService,
  opts: OutcomeSchedulerOptions = {},
): OutcomeScheduler {
  const intervalMs = opts.intervalMs ?? 30_000;
  let handle: NodeJS.Timeout | null = null;
  let inFlight: Promise<TickResult> | null = null;
  let running = false;

  const log = opts.logger ?? {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  async function tick(includeShadows = true, shadowHorizonCandles = 12): Promise<TickResult> {
    const ranAt = Date.now();
    const t0 = ranAt;
    // safety wrap: nunca deixa um erro derrubar o loop.
    try {
      const decisionsResult = await analytics.evaluatePending();
      let shadowsResult: { evaluated: number; outcomes: Record<string, number> } | null = null;
      if (includeShadows) {
        shadowsResult = await analytics.evaluatePendingShadows(shadowHorizonCandles);
      }
      const r: TickResult = {
        evaluated: decisionsResult.evaluated,
        outcomes: decisionsResult.outcomes,
        shadowsEvaluated: shadowsResult?.evaluated,
        durationMs: Date.now() - t0,
        ranAt,
      };
      log.info("scheduler.tick", {
        evaluated: r.evaluated,
        outcomes: r.outcomes,
        shadows: r.shadowsEvaluated,
        durationMs: r.durationMs,
      });
      return r;
    } catch (e) {
      log.error("scheduler.tick.error", { message: String(e) });
      return {
        evaluated: 0,
        outcomes: { hit: 0, miss: 0, flat: 0, pending: 0, stalled: 0, error: 0 },
        durationMs: Date.now() - t0,
        ranAt,
      };
    }
  }

  return {
    get running() {
      return running;
    },

    start() {
      if (running) return;
      running = true;
      log.info("scheduler.start", { intervalMs, providerId: opts.providerId ?? null });
      // Primeiro tick imediato (fire-on-start) + agendado.
      inFlight = tick().finally(() => { inFlight = null; });
      handle = setInterval(() => {
        // Uma única avaliação por vez: evita writers concorrentes e dupla contagem.
        if (inFlight) return;
        inFlight = tick().finally(() => { inFlight = null; });
      }, intervalMs);
      // Mantém o processo vivo (não usar unref() — scheduler é essencial).
    },

    async stop() {
      if (!running) return;
      running = false;
      if (handle) {
        clearInterval(handle);
        handle = null;
      }
      if (inFlight) {
        try { await inFlight; } catch { /* swallow */ }
        inFlight = null;
      }
      log.info("scheduler.stop");
    },

    runOnce(opts2) {
      return tick(opts2?.includeShadows ?? true, opts2?.shadowHorizonCandles ?? 12);
    },
  };
}
