/**
 * DATAHUB EVENT BUS — barramento de eventos NAO BLOQUEANTE do TraceCom.
 *
 * Garantias de pesquisa:
 *  - publish() apenas valida e enfileira por subscriber (O(1)); NUNCA executa handler em linha.
 *  - subscriber lento tem fila propria limitada: ao encher, descarta o MAIS ANTIGO e contabiliza.
 *  - ordem por subscriber preservada; sequencia monotona por mercado/producer; dedupe por eventId.
 *  - gap de sequencia e registrado (nunca "corrigido" silenciosamente).
 *  - restart() limpa filas/dedupe e reinicia sequencias (novo epoch) sem contaminar mercado/conta.
 *
 * Este modulo NAO decide, NAO envia ordem e NAO altera nenhum modulo do hot path.
 */
import { makeEvent, validateEvent } from "./event-schema.mjs";
import { RollingWindow, RateCounter, processSnapshot } from "./metrics.mjs";

export const EVENT_BUS_VERSION = "datahub-event-bus-v1";

export class DataHubEventError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export class EventBus {
  constructor({ now = () => Date.now(), defaultMaxQueue = 512, maxBatch = 32, dedupeWindowMs = 120_000, maxTrackedIds = 8_000, log = () => {} } = {}) {
    this.now = now;
    this.defaultMaxQueue = Math.max(8, Number(defaultMaxQueue) || 512);
    this.maxBatch = Math.max(1, Number(maxBatch) || 32);
    this.dedupeWindowMs = Math.max(1_000, Number(dedupeWindowMs) || 120_000);
    this.maxTrackedIds = Math.max(64, Number(maxTrackedIds) || 8_000);
    this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.epoch = 1;
    this.enabled = true;
    this.subscribers = new Map();
    this.sequences = new Map();
    this.expectedSequences = new Map();
    this.seenIds = new Map();
    this.deliveryLatency = new RollingWindow({ maxSamples: 2_048 });
    this.counters = { published: 0, ingested: 0, invalid: 0, duplicates: 0, sequenceGaps: 0, restarts: 0, enabledDrops: 0 };
    this.typeCounter = new RateCounter({ now });
    this.publishCounter = new RateCounter({ now });
    this.cpuBaseline = process.cpuUsage();
    this.createdAt = now();
    this.waiters = [];
    this.subscriberSeq = 0;
    this.oldestEventAt = null;
  }

  get subscriberCount() { return this.subscribers.size; }
  get epochNumber() { return this.epoch; }

  subscribe({ id = null, eventTypes = null, marketKey = null, marketType = null, accountContext = null, producer = null, maxQueue = null, handler } = {}) {
    if (typeof handler !== "function") throw new DataHubEventError("SUBSCRIBER_HANDLER_REQUIRED");
    const subscriptionId = id ?? `sub_${++this.subscriberSeq}`;
    const subscription = {
      id: subscriptionId,
      filter: {
        eventTypes: Array.isArray(eventTypes) && eventTypes.length ? new Set(eventTypes) : null,
        marketKey: marketKey ?? null,
        marketType: marketType ?? null,
        accountContext: accountContext ?? null,
        producer: producer ?? null,
      },
      maxQueue: Math.max(8, Number(maxQueue) || this.defaultMaxQueue),
      handler,
      queue: [],
      scheduled: false,
      dropped: 0,
      delivered: 0,
      errors: 0,
      consecutiveErrors: 0,
      lastError: null,
      lastDeliveryAt: null,
      highWater: 0,
      latency: new RollingWindow({ maxSamples: 512 }),
    };
    this.subscribers.set(subscriptionId, subscription);
    return {
      id: subscriptionId,
      unsubscribe: () => this.unsubscribe(subscriptionId),
      stats: () => this.subscriberStats(subscriptionId),
    };
  }

  unsubscribe(id) {
    const subscription = this.subscribers.get(id);
    if (!subscription) return false;
    subscription.queue = [];
    this.subscribers.delete(id);
    return true;
  }

  /** Cria, valida e enfileira um evento novo (sequencia atribuida pelo bus). */
  publish(input = {}) {
    if (!this.enabled) { this.counters.enabledDrops += 1; return null; }
    const key = input.marketKey ?? "GLOBAL";
    const sequence = Number.isFinite(Number(input.sequence)) ? Number(input.sequence) : this.#nextSequence(key);
    const event = makeEvent({ ...input, sequence });
    const validation = validateEvent(event);
    if (!validation.ok) { this.counters.invalid += 1; throw new DataHubEventError("EVENT_INVALID", validation.errors.join(",")); }
    if (!Number.isFinite(Number(input.sequence))) this.#trackExpected(event);
    this.counters.published += 1;
    this.publishCounter.add(1);
    this.typeCounter.add(1);
    if (this.oldestEventAt === null) this.oldestEventAt = event.localTime;
    this.#dispatch(event);
    return event;
  }

  /** Ingestao de evento externo (validado, deduplicado e checado contra gap de sequencia). */
  ingest(event = {}) {
    const validation = validateEvent(event);
    if (!validation.ok) { this.counters.invalid += 1; return { ok: false, errors: validation.errors, deduplicated: false, gap: null }; }
    if (this.#isDuplicate(event)) { this.counters.duplicates += 1; return { ok: true, errors: [], deduplicated: true, gap: null }; }
    const gap = this.#noteSequence(event);
    this.counters.ingested += 1;
    this.#dispatch(event);
    return { ok: true, errors: [], deduplicated: false, gap };
  }

  /** Entrega imediata (fora de banda) para inspecao/relatorios; nao afeta o caminho normal. */
  snapshotRecent(limit = 100) {
    const rows = [];
    for (const subscription of this.subscribers.values()) {
      for (const entry of subscription.queue.slice(-limit)) rows.push({ subscriberId: subscription.id, event: entry.event });
    }
    return rows;
  }

  flush() {
    if (this.#idle()) return Promise.resolve(true);
    return new Promise((resolve) => { this.waiters.push(resolve); this.#scheduleAll(); });
  }

  stop(reason = "STOP") {
    this.enabled = false;
    for (const subscription of this.subscribers.values()) subscription.queue = [];
    this.#resolveWaiters();
    this.log("DATAHUB_EVENT_BUS_STOPPED", JSON.stringify({ reason, epoch: this.epoch }));
    return { stopped: true, reason, epoch: this.epoch };
  }

  start() { this.enabled = true; this.#resolveWaiters(); return { started: true, epoch: this.epoch }; }

  restart(reason = "RESTART") {
    this.epoch += 1;
    this.counters.restarts += 1;
    this.sequences.clear();
    this.expectedSequences.clear();
    this.seenIds.clear();
    this.oldestEventAt = null;
    for (const subscription of this.subscribers.values()) {
      subscription.queue = [];
      subscription.consecutiveErrors = 0;
    }
    this.log("DATAHUB_EVENT_BUS_RESTARTED", JSON.stringify({ reason, epoch: this.epoch }));
    return { restarted: true, reason, epoch: this.epoch };
  }

  stats() {
    const process = processSnapshot(this.cpuBaseline);
    return {
      version: EVENT_BUS_VERSION,
      enabled: this.enabled,
      epoch: this.epoch,
      subscribers: this.subscriberCount,
      sequenceStreams: this.sequences.size,
      published: this.counters.published,
      ingested: this.counters.ingested,
      invalid: this.counters.invalid,
      duplicates: this.counters.duplicates,
      sequenceGaps: this.counters.sequenceGaps,
      enabledDrops: this.counters.enabledDrops,
      restarts: this.counters.restarts,
      eventsPerSecond: this.publishCounter.ratePerSecond(),
      deliveryLatencyMs: this.deliveryLatency.summary(),
      process,
      uptimeMs: this.now() - this.createdAt,
      perSubscriber: [...this.subscribers.values()].map((subscription) => this.#subscriberView(subscription)),
    };
  }

  subscriberStats(id) {
    const subscription = this.subscribers.get(id);
    return subscription ? this.#subscriberView(subscription) : null;
  }

  #subscriberView(subscription) {
    return {
      id: subscription.id,
      filter: {
        eventTypes: subscription.filter.eventTypes ? [...subscription.filter.eventTypes] : null,
        marketKey: subscription.filter.marketKey,
        marketType: subscription.filter.marketType,
        accountContext: subscription.filter.accountContext,
        producer: subscription.filter.producer,
      },
      queued: subscription.queue.length,
      dropped: subscription.dropped,
      delivered: subscription.delivered,
      errors: subscription.errors,
      lastError: subscription.lastError,
      latestPassiveLagMs: subscription.queue.length ? this.now() - subscription.queue[0].enqueuedAt : 0,
      highWater: subscription.highWater,
      latencyMs: subscription.latency.summary(),
    };
  }

  #nextSequence(key) {
    const next = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, next);
    return next;
  }

  #trackExpected(event) {
    const stream = `${event.producer}:${event.marketKey ?? "GLOBAL"}`;
    this.expectedSequences.set(stream, { next: Number(event.sequence) + 1, last: Number(event.sequence) });
  }

  #noteSequence(event) {
    if (!Number.isFinite(Number(event.sequence))) return null;
    const stream = `${event.producer}:${event.marketKey ?? "GLOBAL"}`;
    const state = this.expectedSequences.get(stream) ?? null;
    const sequence = Number(event.sequence);
    let gap = null;
    if (state && sequence > state.next) {
      gap = { stream, expected: state.next, received: sequence, missing: sequence - state.next };
      this.counters.sequenceGaps += gap.missing;
      this.log("DATAHUB_SEQUENCE_GAP", JSON.stringify(gap));
    }
    const next = sequence + 1;
    const last = state?.last ?? null;
    if (next > (state?.next ?? 0) || last === null || sequence > last) this.expectedSequences.set(stream, { next, last: sequence });
    return gap;
  }

  #isDuplicate(event) {
    const now = this.now();
    const existing = this.seenIds.get(event.eventId);
    if (existing !== undefined && existing >= now) return true;
    if (this.seenIds.size > this.maxTrackedIds) {
      for (const [id, expiresAt] of this.seenIds) { if (expiresAt < now) this.seenIds.delete(id); }
      if (this.seenIds.size > this.maxTrackedIds) {
        const oldest = [...this.seenIds.entries()].sort((a, b) => a[1] - b[1]).slice(0, Math.floor(this.maxTrackedIds / 4));
        for (const [id] of oldest) this.seenIds.delete(id);
      }
    }
    this.seenIds.set(event.eventId, now + this.dedupeWindowMs);
    return false;
  }

  #matches(subscription, event) {
    const filter = subscription.filter;
    if (filter.eventTypes && !filter.eventTypes.has(event.eventType)) return false;
    if (filter.marketKey !== null && event.marketKey !== filter.marketKey) return false;
    if (filter.marketType !== null && event.marketType !== filter.marketType) return false;
    if (filter.accountContext !== null && event.accountContext !== filter.accountContext) return false;
    if (filter.producer !== null && event.producer !== filter.producer) return false;
    return true;
  }

  #dispatch(event) {
    for (const subscription of this.subscribers.values()) {
      if (!this.#matches(subscription, event)) continue;
      this.#enqueue(subscription, event);
    }
    this.#maybeIdle();
  }

  #enqueue(subscription, event) {
    if (subscription.queue.length >= subscription.maxQueue) {
      subscription.queue.shift();
      subscription.dropped += 1;
    }
    subscription.queue.push({ event, enqueuedAt: this.now() });
    if (subscription.queue.length > subscription.highWater) subscription.highWater = subscription.queue.length;
    this.#scheduleDrain(subscription);
  }

  #scheduleDrain(subscription) {
    if (subscription.scheduled) return;
    subscription.scheduled = true;
    queueMicrotask(() => this.#drain(subscription));
  }

  #drain(subscription) {
    if (!this.subscribers.has(subscription.id)) return;
    subscription.scheduled = false;
    let processed = 0;
    try {
      while (subscription.queue.length && processed < this.maxBatch) {
        const entry = subscription.queue.shift();
        processed += 1;
        try {
          subscription.handler(entry.event);
          subscription.delivered += 1;
          subscription.consecutiveErrors = 0;
          subscription.lastDeliveryAt = this.now();
          const deliveryLatency = Math.max(0, this.now() - Number(entry.event.availableAt));
          subscription.latency.record(deliveryLatency);
          this.deliveryLatency.record(deliveryLatency);
        } catch (error) {
          subscription.errors += 1;
          subscription.consecutiveErrors += 1;
          subscription.lastError = String(error?.message ?? error).slice(0, 160);
          if (subscription.consecutiveErrors === 1) {
            this.log("DATAHUB_SUBSCRIBER_ERROR", JSON.stringify({ id: subscription.id, error: subscription.lastError }));
          }
        }
      }
    } finally {
      if (subscription.queue.length) this.#scheduleDrain(subscription);
      else this.#maybeIdle();
    }
  }

  #scheduleAll() { for (const subscription of this.subscribers.values()) if (subscription.queue.length) this.#scheduleDrain(subscription); }

  #idle() { return [...this.subscribers.values()].every((subscription) => subscription.queue.length === 0); }

  #maybeIdle() { if (this.#idle()) this.#resolveWaiters(); }

  #resolveWaiters() {
    if (!this.waiters.length) return;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve(true);
  }
}
