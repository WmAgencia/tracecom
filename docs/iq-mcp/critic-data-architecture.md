# IQ Official MCP — Fresh-Critic Data & Architecture Audit

Run: 2026-09-17 · Adversarial reviewer (independent from builder) · Scope: `relay/iq-mcp/*`,
`tests/ai/iq-mcp-*.test.ts`, `docs/iq-mcp/*`. Practice only; zero real connections, zero orders;
every test uses mocked transports (`fetch` injected) and temporary files.

Method: attacked the comparison path with adversarial catalogs (same canonical / symbol / display,
contradictory `marketKey`/`marketType`, duplicate names, missing OTC suffix, missing timestamps),
traced every AI/decision import, and measured the JSONL persistence path. Every FIXED item ships
with a regression test executed in this run.

Supplement to `security-audit.md` (which keeps its own F-01…F-07 plus the previously OPEN JSONL item,
now closed here as C-03).

---

## 1. Findings

| FINDING | EVIDENCE (file:line) | SEVERITY | COUNTEREXAMPLE | STATUS |
|---|---|---|---|---|
| C-01 NORMAL/OTC cross-match via fabricated identity. A market without an explicit `marketKey` derived `NORMAL` whenever `marketType` was missing/whitespace/unknown, even when `symbol`/`display` carried the `(OTC)` marker; contradictory key/type/canonical evidence was silently trusted. Result: `EURUSD:OTC`-class market paired with the NORMAL MCP asset (payout compared as MATCH). | `reconciliation.mjs:122` (`marketIdentity`), `:255` (`pairMarkets`); pre-fix `expectedMarketKey` defaulted `:NORMAL` | HIGH (wrong-market data into the comparison path) | `{canonical:"EURUSD", symbol:"EUR/USD", display:"EUR/USD (OTC)", activeId:76}` with no `marketType` paired asset `{asset_id:80, name:"EUR/USD"}` and reported `PAYOUT: MATCH` against the wrong market type. | **FIXED** — identity is now derived from all evidence (`marketKey`, `marketType`, OTC marker in display+symbol, canonical); any contradiction emits `MARKET_KEY_TYPE_CONFLICT` / `MARKET_KEY_CANONICAL_CONFLICT` / `MARKET_TYPE_EVIDENCE_CONFLICT` and never pairs. Regressions: `iq-mcp-critic-data.test.ts` → "derives OTC from the display/symbol marker", "marketKey/marketType contradiction", "canonical contradiction", "marketType NORMAL + OTC marker", "normalizes whitespace/case". |
| C-02 Missing `sourceTimestamp` produced silent `MATCH`. `skewBetween` returned `0` when either side was absent, so a snapshot with no `at`/`serverTime` was classified as fresh. | `reconciliation.mjs:213` (`withSourceFreshness`); pre-fix `skewBetween` returned `0` on null | HIGH (freshness unprovable → fabricated agreement) | office body without `at`/`serverTime` → `CATALOG/PAYOUT/AVAILABILITY: MATCH`. | **FIXED** — comparable records with no source timestamp become `NOT_COMPARABLE` (`SOURCE_TIMESTAMP_MISSING`, `skewMs:null`); structural catalog conflicts are preserved; account records use the account's own `at`. Regression: `iq-mcp-critic-data.test.ts` → "downgrades every comparable record", "keeps account records comparable", "never upgrades NOT_COMPARABLE to STALE_SOURCE". |
| C-03 Unbounded JSONL history: `loadHistory` read the whole file (`readFile`) and `persistRecords` appended forever (previously OPEN in `security-audit.md`). | `reconciliation.mjs:712` (`readTailText`), `:750` (`rotateHistory`), `:766` (`persistRecords`), `:789` (`loadHistory`) | MEDIUM (disk/memory growth, unbounded read latency) | 29k records/day × months → every history read loads the full file into memory; no rotation. | **FIXED** — bounded tail read (`maxBytes`, default 2 MiB, drops the cut first line) and post-append rotation (`maxRecords`, default 20k, best-effort; append never fails on rotation). Regressions: `iq-mcp-critic-architecture.test.ts` → "reads only a bounded tail", "rotates the JSONL file", "keeps history intact below the cap". |
| C-04 Adapter expanded the `is_open` boolean into 5-state names (`OPEN`/`DISABLED` from `getMarketStatus`), allowing the boolean to masquerade as the availability enum. | `adapter.mjs:628–661` (`getMarketStatus`); pre-fix `is_open ? "OPEN" : "DISABLED"` | MEDIUM (availability semantics conflated outside the 5-state model) | `is_open:false` on a suspended asset → `"DISABLED"`, indistinguishable from the internal `DISABLED` state. | **FIXED** — projection is boolean-faithful: `status` ∈ `OPEN|CLOSED|NOT_OFFERED` plus raw `isOpen` (boolean or `null`); `SUSPENDED`/`DISABLED`/`UNKNOWN` can no longer be emitted from the boolean. Regressions: `iq-mcp-critic-data.test.ts` → "adapter getMarketStatus projection never emits the 5-state names" (updated `iq-mcp-adapter.test.ts` expectation). |
| C-05 Wrong-but-plausible field agreement when `activeId` ≠ MCP `asset_id`. CATALOG was flagged `ASSET_ID_MISMATCH` but payout/expirations/availability were still compared against the mismatched asset (identical values → `PAYOUT: MATCH`). | `reconciliation.mjs:268` (`identityMismatch`), `:385`, `:425`, `:476` | MEDIUM (field agreement attached to a wrong identity) | internal `{marketKey:"EURUSD:OTC", activeId:999}` + MCP `{asset_id:76, profit_percent:85}` and equal payout → payout `MATCH` despite the identity conflict. | **FIXED** — `identityMismatch` blocks payout/expirations/availability (`IDENTITY_MISMATCH`, `NOT_COMPARABLE`); CATALOG keeps `ASSET_ID_MISMATCH` with the delta. Regression: `iq-mcp-critic-data.test.ts` → "an activeId/asset_id disagreement blocks value comparisons". |
| C-06 Rate-limit starvation under concurrent bursts. `_acquire` slept once and retried once; interleaved waiters could steal the refilled token, so a queued call failed with `MCP_RATE_LIMITED` even though the limiter would grant it. | `adapter.mjs:396` (`_acquire`) | MEDIUM (false local rate-limit failures; diagnostics dropped) | 100 concurrent `getCandles` with `maxRateWaitMs:5000` → 99 calls, 1 `MCP_RATE_LIMITED` although 40 s of simulated refill was available. | **FIXED** — retry loop with per-step bound (`waitMs ≤ maxRateWaitMs`), no starvation. Regression: `iq-mcp-critic-architecture.test.ts` → "queues a concurrent burst through the local limiter without starvation" (also covered by the concurrent reliability suite). |

## 2. Verified clean (no defect found)

| FINDING | EVIDENCE | SEVERITY | COUNTEREXAMPLE | STATUS |
|---|---|---|---|---|
| Payout is exact; balance tolerance cannot leak into it | `reconciliation.mjs:145` (`classifyNumeric`), payout callers pass `null`; balance passes `BALANCE_TOLERANCE` only | MEDIUM if broken | Δ = 0.01, 0.1, 0.5, 0.9, 1 on payout → `CONFLICT`; Δ = 0.5 on balance → `MINOR_DIFFERENCE` | ACCEPTED (verified) — `iq-mcp-critic-data.test.ts` → "payout is exact, tolerance is balance-only" |
| `is_open` never becomes a 5-state in reconciliation | `reconciliation.mjs:452–504` (`availabilityRecord`) | HIGH if broken | every state × boolean: `mcpValue` is boolean/`null`, only `OPEN+true` MATCHes, non-OPEN stays `BOOLEAN_ONLY` | ACCEPTED (verified) — `iq-mcp-critic-data.test.ts` → "never emits a state string for MCP availability" |
| Duplicate names across servers cannot produce a plausible MATCH | `reconciliation.mjs:255–300` (`AMBIGUOUS_MCP_MATCH`) | MEDIUM | two assets named `EUR/USD (OTC)` with identical payout/is_open → CATALOG `CONFLICT`, fields `NOT_COMPARABLE` | ACCEPTED (verified) — "duplicate names … are AMBIGUOUS" |
| MCP assets lacking the `(OTC)` suffix never pair with the OTC market | `reconciliation.mjs:78–90` (`assetMarketType`/`assetMarketKey`), key equality in `pairMarkets` | MEDIUM | OTC market + OTC instrument named `EUR/USD` (no marker) → `NO_MCP_COUNTERPART`, never a MATCH | ACCEPTED (verified) — "never pairs the OTC market with an MCP asset that lacks the (OTC) suffix"; residual heuristic risk below |
| STALE_SOURCE boundary strict | `reconciliation.mjs:206–211` (`withStale`) | LOW | skew exactly 5 min → MATCH; +1 ms → `STALE_SOURCE`; NOT_COMPARABLE is never upgraded | ACCEPTED (verified) — "fires STALE_SOURCE only past the 5 minute boundary" |
| Determinism of comparison records | `reconciliation.mjs:622` (`buildComparisons`), no `Math.random`; timestamp injected | LOW | same inputs → byte-identical JSON; different `now` changes only `timestamp` | ACCEPTED (verified) — `iq-mcp-critic-data.test.ts` → determinism block |
| MCP never enters the hot path | repo scan: no `src/` or `api/` file references `iq-mcp`; no top-level `relay/*.mjs` imports it; adapter has no `setInterval`; only `shadow.mjs` constructs the adapter | HIGH if violated | any decision/JIT module importing `relay/iq-mcp/adapter.mjs` → test fails | ACCEPTED (verified, enforced) — `iq-mcp-critic-architecture.test.ts` → "MCP stays out of the hot path" |
| Shadow is interval-based and inert while disabled | `shadow.mjs:51` (`shadowEnabled`), `:135–150` (recursive `setTimer`), `:204` (`runOnce`); no `setInterval` | HIGH if violated | disabled runner: `start()` returns `MCP_SHADOW_DISABLED`, zero timers, zero fetches | ACCEPTED (verified, enforced) — architecture test + `iq-mcp-shadow.test.ts` |
| Fail-soft `{ok:false}` propagation | `adapter.mjs:382–394` (`_fail`/`_transportFail`), every public method returns the envelope | HIGH if broken | offline/sync-throwing transport: all 11 public methods resolve `{ok:false, error.code}`; gateway propagates `{ok:false}` | ACCEPTED (verified, enforced) — architecture test |
| LLM gateway cannot reach the adapter/token | `llm-guard.mjs` imports only `security.mjs`, no `fetch(`, no `adapter.mjs` | HIGH if broken | scan assertion | ACCEPTED (verified, enforced) — architecture test |
| Adapter TTL cache bounded | `adapter.mjs:543` (`_cacheSet`), hard cap `MAX_CACHE_ENTRIES` (F-05) | LOW | covered by `iq-mcp-reliability.test.ts` | ACCEPTED (verified) |

## 3. Residual accepted risks

- **OTC marker heuristic (C-01 residual):** `assetMarketType` types an asset as OTC whenever its name contains a standalone `OTC` token. A contrived broker name such as `EUR/USD (OTC-free)` is typed OTC (canonical `EURUSDFREE`); real broker names use the `(OTC)`/`OTC` suffix exclusively. Safe direction (mis-typing to OTC only blocks a NORMAL pairing), no fabricated agreement.
- **`findAsset` string coercion:** `String(asset_id)` still matches the literal string `"null"` (pre-existing INFO; server ids are numeric).
- **`_acquire` loop:** each wait step is bounded by `maxRateWaitMs`, but a caller under sustained local contention can accumulate several steps before acquiring or failing. The bucket refills monotonically and the shadow path is demand-only, so no permanent lockout; a hostile *remote* cannot influence local buckets (429 pauses are clamped to 15 min > default wait → immediate fail).
- **Executor errors in `llm-guard`:** the optional `execute(tool,args)` hook is caller-wired and its rejections are the caller's; the verified transport (adapter) never throws into callers (proven above).

## 4. Cross-workstream note

While this audit ran, a concurrent critic workstream added `tests/ai/iq-mcp-critic-reliability.test.ts`
and adapter hardening (`isError:true` → `MCP_TOOL_ERROR`), which this run executed green (38/38). The
C-06 starvation fix above resolves the remaining red test in that suite; both suites now pass together.

## 5. Verification (this run)

- `node --check relay/iq-mcp/reconciliation.mjs relay/iq-mcp/adapter.mjs` — OK.
- `npx vitest run tests/ai/iq-mcp-reconciliation.test.ts tests/ai/iq-mcp-shadow.test.ts tests/ai/iq-mcp-adapter.test.ts tests/ai/iq-mcp-llm-guard.test.ts tests/ai/iq-mcp-security.test.ts` — green (88/88).
- `npx vitest run tests/ai` — green (see run log; includes the new critic suites).
- `npx tsc -p tsconfig.json --noEmit` — clean.
- Zero orders, zero real connections; all transports mocked; no token written to any file.
