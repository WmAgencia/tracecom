# IQ Official MCP — Fresh-Critic Security Audit

Run: 2026-09-17 · Adversarial reviewer (independent from builder) · Scope: `relay/iq-mcp/*`,
`scripts/iq-mcp-*.mjs`, `tests/ai/iq-mcp-*.test.ts`, `docs/iq-mcp/*`.
No network used; no token written to any file; PRACTICE only, ZERO REAL, no orders.

Method: read every listed file, traced every path from an AI caller / script to the token, to
`tools/call`, to disk, and to the trading path. Every FIXED item below ships with a regression
test executed in this run. Line numbers refer to the post-fix revision.

---

## 1. Findings (FIXED in this run)

### F-01 — Server-controlled rate-limit inflation (tighten-only bypass)
- **FINDING:** `get_limits` payload was applied verbatim to the local token buckets. A
  compromised/malicious MCP endpoint could raise the adapter's own 60 reads/min cap to any value,
  defeating the local safety limiter.
- **EVIDENCE:** `relay/iq-mcp/adapter.mjs:715` (`_applyServerLimits`, called at `:711`);
  pre-fix it called `limiter.setLimit(name, limit, windowMs)` with unvalidated server numbers.
- **SEVERITY:** MEDIUM (remote-controlled rate control; no write path).
- **COUNTEREXAMPLE:** server returns `buckets:[{bucket:"read",limit:1000000,window_seconds:1}]`
  → local read bucket becomes 1M/s; an LLM tool loop can then hammer the broker endpoint.
- **STATUS:** **FIXED** — tighten-only clamp `Math.min(server limit, default limit)` /
  `Math.max(server window, default window)`; unknown bucket names ignored.
  Regression: `tests/ai/iq-mcp-reliability.test.ts` → "never lets server-reported limits raise
  the local buckets", "applies stricter server limits (tighten-only)".

### F-02 — Hostile `Retry-After` permanent lockout
- **FINDING:** a 429 response paused gateway/read/write buckets for the full server-provided
  `Retry-After`, with no ceiling.
- **EVIDENCE:** `relay/iq-mcp/adapter.mjs:445` (pre-fix `:417–420`).
- **SEVERITY:** MEDIUM (denial of the MCP data path by a single server response).
- **COUNTEREXAMPLE:** `429 Retry-After: 31536000` → adapter paused for one year; every later
  read fails locally with `MCP_RATE_LIMITED`.
- **STATUS:** **FIXED** — clamped to `MAX_RATE_LIMIT_PAUSE_MS` (15 min, `adapter.mjs:74`).
  Regression: "clamps a hostile retry-after so a remote server cannot lock the adapter out
  forever".

### F-03 — Bearer token disclosed by JSON serialization
- **FINDING:** `this.secret` was an enumerable own property; any `JSON.stringify(adapter)`,
  debug dump or error-reporter serialization emitted the live token in clear text.
- **EVIDENCE:** `relay/iq-mcp/adapter.mjs:320` (`Object.defineProperty(this, "secret", { enumerable:false })`).
- **SEVERITY:** HIGH (credential disclosure; token grants read-write on the broker per
  `get_capabilities.mode=read-write`).
- **COUNTEREXAMPLE:** `console.log(JSON.stringify(adapter))` → `{"...","secret":"<live-bearer-token>"}` (pre-fix).
- **STATUS:** **FIXED** — non-enumerable non-serializable, still writable for token rotation.
  Regression: "keeps the token out of JSON serialization (non-enumerable secret)".

### F-04 — JSON-RPC response confusion (SSE and JSON id mismatch)
- **FINDING:** `parseRpcBody` accepted `events.find(result/error)` or the last SSE event when no
  id matched, and never checked the id on JSON bodies. A wrong/mismatched response could be
  attributed to the caller's request.
- **EVIDENCE:** `relay/iq-mcp/adapter.mjs:127–152`.
- **SEVERITY:** MEDIUM (wrong account data into a decision path; server-controlled).
- **COUNTEREXAMPLE:** request `id=2` answered with `id=9999 result:{balances:[…]}` → adapter
  accepted it as its own response.
- **STATUS:** **FIXED** — SSE accepts only the matching id or an id-less result frame; JSON body
  with a different id → `MCP_MALFORMED`. Regressions: "rejects an SSE frame carrying a mismatched
  request id (response confusion)" + existing handshake tests.

### F-05 — Unbounded TTL-cache growth
- **FINDING:** `_cacheSet` pruned expired entries only when `size > 256` and only expired ones;
  no hard ceiling, no eviction of live entries.
- **EVIDENCE:** `relay/iq-mcp/adapter.mjs:531` (`_cacheSet`), `:77` (`MAX_CACHE_ENTRIES`).
- **SEVERITY:** LOW (today the 60 reads/min limiter bounds live keys; any TTL/limit change or
  internal caller breaks the implicit bound).
- **COUNTEREXAMPLE:** 100k distinct `getPositions(balance_id)` within one 10 s TTL window keeps
  every entry live; the prune loop never removes any.
- **STATUS:** **FIXED** — hard cap (default 256, `maxCacheEntries`), expired-first then
  oldest-first eviction. Regression: "bounds the TTL cache with expired-first, oldest-first
  eviction".

### F-06 — Timeout classified as UNAVAILABLE instead of DEGRADED
- **FINDING:** `MCP_TIMEOUT` mapped to `HEALTH.UNAVAILABLE`, conflating a transient timeout with a
  hard outage and mislabeling health for fallback logic.
- **EVIDENCE:** `relay/iq-mcp/adapter.mjs:196–201` (`healthFor`).
- **SEVERITY:** LOW/INFO (health signalling, not credential/order risk).
- **COUNTEREXAMPLE:** one 20 s timeout while the WS path is healthy → adapter reports
  UNAVAILABLE, tripping outage-oriented consumers.
- **STATUS:** **FIXED** — `MCP_TIMEOUT → DEGRADED`; `MCP_NETWORK`/`MCP_HTTP_5XX`/`MCP_DISABLED`
  remain UNAVAILABLE. Regressions: reliability timeout test + updated
  `tests/ai/iq-mcp-adapter.test.ts` timeout expectation.

### F-07 — No per-AI-layer isolation gateway (privilege separation)
- **FINDING:** write blocking existed inside the adapter, but there was no per-agent read-only
  boundary: any process caller could attempt any name; there was no security-tested isolation for
  the six AI layers named by the pipeline (trader, critic, professor, supervisor, research,
  orchestrator).
- **EVIDENCE:** absent module (pre-fix); adapter surface `relay/iq-mcp/adapter.mjs:595`
  (`invokeTool`) was the only gate.
- **SEVERITY:** HIGH (defense-in-depth failure: a single adapter regression would expose
  `place_trade/sell_position/rollover_position`, which the live token can call).
- **COUNTEREXAMPLE:** an LLM-driven component could call `adapter.invokeTool("sell_position")`
  and depend solely on the same process/module gate that an attacker would target.
- **STATUS:** **FIXED** — new `relay/iq-mcp/llm-guard.mjs`: `createAgentToolGateway({agent})` +
  `callTool(name,args)`; NFKC+case+zero-width normalization; 11-tool read allowlist; write-intent
  regex (`place_|sell|close_|cancel_|rollover_|change_|set_|update_|reset_|switch_|buy|deposit|
  withdraw|transfer`) plus ORDER_WRITE/ACCOUNT_WRITE/UNKNOWN classification → `MCP_WRITE_BLOCKED`;
  unknown agent → `MCP_AGENT_NOT_ALLOWED`; non-string names refused without `toString()`
  coercion; frozen allowlist/Set lookups (no prototype surface). 30 tests in
  `tests/ai/iq-mcp-llm-guard.test.ts`.

---

## 2. Hunt results (verified clean / accepted / open)

### Token leakage paths (env → logs → errors → JSONL → docs)
| FINDING | EVIDENCE | SEVERITY | COUNTEREXAMPLE | STATUS |
|---|---|---|---|---|
| Token resolution env-only, no persistence | `adapter.mjs:340–353`; scripts read `IQ_MCP_TOKEN`/`_FILE` (`iq-mcp-discover.mjs:37`, `read-probe:18`, `products-probe:415`, `account-validate:20`) | INFO | none | ACCEPTED (verified) |
| Error messages redacted before return | `adapter.mjs:374–377` (`_fail` → `redactSecret`), `security.mjs:9–21` | LOW | server echoes token in JSON-RPC error → `<REDACTED>` | ACCEPTED (test `iq-mcp-adapter.test.ts` RPC-error redaction) |
| Script artifacts redacted before disk | `discover.mjs:132,148`; `read-probe:91,104`; `products-probe:375,397,407`; `account-validate:293–300` (throws `SECRET_LEAK_*` if `containsSecret`) | LOW | — | ACCEPTED (verified) |
| Repo/docs contain no live token | repo-wide grep for the token prefix + `Bearer/authorization` in `docs/iq-mcp` → no match; `.env.local` has no `IQ_MCP_TOKEN` (gitignored) | HIGH if present | — | ACCEPTED (verified absent) |
| `redact()` cannot catch unlabeled secrets when no `secret` arg is passed | `security.mjs:9–21` (label-based regex + exact-match only) | LOW | `redact('{"v":"<raw-token>"}')` with empty secret leaks | ACCEPTED RISK — every live caller passes its `SECRET` |
| `writeProbeArtifacts` defaults `redact` to identity | `scripts/iq-mcp-products-probe.mjs:371`; `main()` passes `redactSecret` at `:427–430` | LOW | a future caller omitting `redact` writes unredacted artifacts | OPEN (scripts outside authorized fix scope; payloads already deep-redacted at `:362`) |

### Write-tool reachability
| FINDING | EVIDENCE | SEVERITY | COUNTEREXAMPLE | STATUS |
|---|---|---|---|---|
| Every `tools/call` passes the tool gate; writes/unknown always throw, even with `IQ_MCP_WRITE_ENABLED` | `adapter.mjs:364–371` (`_gate`), `:465–468` (`_rpc`), `:548` (`_readTool`), `:595–604` (`invokeTool`); `security.mjs:41–42,95–103` | HIGH if broken | `invokeTool("place_trade",{})` with `writeEnabled:true` → `MCP_WRITE_BLOCKED`, zero fetch | ACCEPTED (verified by tests) |
| LLM layers isolated from writes by name/intent/classification | `llm-guard.mjs` (new); tests per agent | HIGH | `trader.callTool("PLACE_TRADE")` / full-width / zero-width / `__proto__` → `MCP_WRITE_BLOCKED` | FIXED (F-07) |

### Hot-path coupling (sync MCP call inside JIT/decision)
| FINDING | EVIDENCE | SEVERITY | COUNTEREXAMPLE | STATUS |
|---|---|---|---|---|
| Adapter imported only by scripts/tests — zero `src/` imports | repo grep: only `scripts/*`, `tests/ai/*`, `docs/*` reference `iq-mcp` | HIGH if violated | — | ACCEPTED (invariant holds at this revision) |
| Adapter is demand-only: no timers/intervals; limiter/cache only | `adapter.mjs:13–16` header contract; no `setInterval` in module | HIGH | `_rpc` only runs on an awaited caller | ACCEPTED |
| Shadow runner is off-hot-path, both-env gated, `unref`'d recursive timeout + injected clock | `shadow.mjs:51–53` (`shadowEnabled`), `:135–151` (`#schedule`), `:68–73` (injectable `now`/`random`) | MEDIUM | accidentally importing `shadow.mjs` into JIT would schedule outside the path, not block it | ACCEPTED (must stay un-imported; see F-07 note) |

### Non-determinism
| FINDING | EVIDENCE | SEVERITY | COUNTEREXAMPLE | STATUS |
|---|---|---|---|---|
| Cache keys canonicalized (sorted keys); id monotonic; assertions use injected `now`/`sleep` | `adapter.mjs:86–91`, `:310–311` | LOW | — | ACCEPTED |
| Server data varies between reads; reconciliation labels differences objectively (no fabrication) | `reconciliation.mjs:353–393` (`is_open` never becomes a state) | LOW | `AVAILABILITY` stays `NOT_COMPARABLE` for non-OPEN | ACCEPTED |
| Shadow jitter uses `Math.random` — scheduling only, not decisions | `shadow.mjs:137` | INFO | — | ACCEPTED |

### Unbounded memory growth (cache / JSONL)
| FINDING | EVIDENCE | SEVERITY | COUNTEREXAMPLE | STATUS |
|---|---|---|---|---|
| In-memory TTL cache had no hard cap | `adapter.mjs:531` | LOW | see F-05 | FIXED (F-05) |
| JSONL history grows without rotation; `loadHistory` reads the whole file | `reconciliation.mjs:593–601` (`appendFile`, no cap), `:605–625` (`readFile` whole file) | LOW | shadow cadence (60 s) × ~20 records = ~29k records/day; history read loads everything | **OPEN** — concurrent module added mid-audit (owned by another workstream, currently red tests); recommended: tail-read with byte cap + rotation/retention |
| Products-probe payload truncation bounds per-payload output | `products-probe.mjs:397–398` (4k cap), `read-probe:101` (3k cap) | LOW | — | ACCEPTED |

### NORMAL/OTC conflation
| FINDING | EVIDENCE | SEVERITY | COUNTEREXAMPLE | STATUS |
|---|---|---|---|---|
| Adapter resolves assets by `asset_id` only — no name-based lookup | `adapter.mjs:167–169` (`findAsset`), `:634–641` (candles by id) | MEDIUM if name-keyed | `getMarketStatus(76)` never falls back to an OTC/NORMAL name match | ACCEPTED |
| Reconciliation pairs canonical **and** market type; `(OTC)` marker is the only discriminator | `reconciliation.mjs:61–74`, `:172–212` (`pairMarkets`, ambiguous match → CONFLICT) | MEDIUM | `EURUSD:OTC` vs `EURUSD`(NORMAL) → `NO_MCP_COUNTERPART`/`NOT_COMPARABLE`, never a false MATCH | ACCEPTED |
| `assetMarketType` assumes the broker keeps the `(OTC)` suffix | `reconciliation.mjs:66–68` | LOW | a renamed OTC asset degrades to NORMAL → safe non-match, no fabricated agreement | ACCEPTED |
| `getMarketStatus("null")` can match an asset whose `asset_id` is `null` via `String()` coercion | `adapter.mjs:167–169` | INFO | `findAsset([{asset_id:null}],"null")` returns the asset | ACCEPTED (ids from server are numeric; callers use numbers) |

---

## 3. Residual accepted risks (explicit)
- Timeout is retryable (`adapter.mjs:429`): worst case `maxRetries` × timeout before fail-soft
  return (~80 s with defaults). Bounded, demand-only; set `maxRetries:0` for latency-critical
  callers.
- `res.text()` has no byte cap (`adapter.mjs:400`): a hostile endpoint could stream a huge body.
  Endpoint is a known broker host over TLS; accepted for this phase.
- `writeEnabled` option is deliberately inert (`adapter.mjs:595–600`): writes are unimplemented and
  always throw, regardless of `IQ_MCP_WRITE_ENABLED`.

## 4. Verification (this run)
- `node --check relay/iq-mcp/llm-guard.mjs relay/iq-mcp/adapter.mjs relay/iq-mcp/security.mjs` — OK.
- `npx vitest run tests/ai/iq-mcp-llm-guard.test.ts tests/ai/iq-mcp-reliability.test.ts` — green.
- `npx tsc -p tsconfig.json --noEmit` — clean.
- Token handling: passed only via `$env:IQ_MCP_TOKEN`; never written to any file, log, doc or test.
- Zero orders, zero real connections: all new tests use mocked fetch; no live endpoint contacted.
