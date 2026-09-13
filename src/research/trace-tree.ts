/** Distributed-trace tree assembly + hop sanitization (pure). */
export type Span = { spanId: string; parentSpanId?: string | null; traceId: string; sessionId?: string | null; component: string; operation: string; startedAt: number; completedAt: number; latencyMs?: number | null; status: string; errorCode?: string | null; relatedIds?: Record<string, unknown> };
export type TraceNode = Span & { children: TraceNode[] };
export type Hop = { requestId?: string | null; traceId?: string | null; hop: string; route: string; method?: string; status: number; startedAt: number; completedAt: number; latencyMs?: number | null; upstream?: string | null; errorCode?: string | null };

const FORBIDDEN_HOP_KEYS = /authorization|cookie|token|secret|apikey|api_key|password|pepper|hash/i;

export function sanitizeHop(hop: Hop): Hop {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(hop)) if (!FORBIDDEN_HOP_KEYS.test(key)) clean[key] = typeof value === "string" ? value.slice(0, 200) : value;
  return clean as Hop;
}

export function buildTraceTree(spans: readonly Span[], hops: readonly Hop[] = []) {
  const nodes = new Map<string, TraceNode>();
  for (const span of spans) nodes.set(span.spanId, { ...span, children: [] });
  const roots: TraceNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentSpanId ? nodes.get(node.parentSpanId) : undefined;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  const sorted = [...nodes.values()].sort((a, b) => a.startedAt - b.startedAt);
  const started = sorted.length ? sorted[0]!.startedAt : null;
  const completed = sorted.length ? Math.max(...sorted.map((node) => node.completedAt)) : null;
  const errors = sorted.filter((node) => node.status === "ERROR" || node.errorCode).map((node) => ({ spanId: node.spanId, component: node.component, operation: node.operation, errorCode: node.errorCode ?? null }));
  return { traceId: spans[0]?.traceId ?? hops[0]?.traceId ?? null, roots, spanCount: sorted.length, hopCount: hops.length, startedAt: started, completedAt: completed, durationMs: started !== null && completed !== null ? completed - started : null, status: errors.length ? "ERROR" : spans.length ? "OK" : "EMPTY", errors, hops: hops.map(sanitizeHop) };
}
