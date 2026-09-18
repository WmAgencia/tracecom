# IQ MCP — Critic Reliability & Mutation Tests

Adversarial critic pass (fresh reviewer, not the builder) over the read-only IQ MCP
surface: `relay/iq-mcp/{adapter,reconciliation,shadow,llm-guard,security}.mjs` and
`tests/ai/iq-mcp-*.test.ts`. Practice only, zero real orders, every transport mocked
(`fetchImpl` injected), no real network, no env secrets.

New suite: `tests/ai/iq-mcp-critic-reliability.test.ts` (38 tests).

## How to reproduce

```
npx vitest run tests/ai/iq-mcp-adapter.test.ts tests/ai/iq-mcp-reliability.test.ts ^
  tests/ai/iq-mcp-critic-reliability.test.ts tests/ai/iq-mcp-shadow.test.ts ^
  tests/ai/iq-mcp-llm-guard.test.ts tests/ai/iq-mcp-security.test.ts ^
  tests/ai/iq-mcp-reconciliation.test.ts tests/ai/iq-mcp-products-probe.test.ts
npx vitest run tests/ai        # 3 consecutive runs
npx tsc -p tsconfig.json --noEmit
```

Observed: targeted 8 files → 157 passed; full `tests/ai` → 34 files / 480 tests passed
on each of 3 consecutive runs; `tsc` exit 0. No test depends on real time (only 15 ms
abort timers and one `vi.waitFor`), real network, env secrets or execution order
(clocks/ids/sessions injected; temp dirs via `mkdtempSync`; assertions on fake-clock
limiter grants instead of wall-clock ordering).

## Findings

| FINDING | EVIDENCE (file:line) | SEVERITY | COUNTEREXAMPLE | STATUS |
|---|---|---|---|---|
| F-REL-01 — `mcp-session-id` was adopted from **any** HTTP response, including 401/429/5xx and malformed/truncated bodies, so a partially-initialized session could be reused by the next call | `relay/iq-mcp/adapter.mjs:443-444` (before fix); now adoption only on accepted responses: `adapter.mjs:463`, `adapter.mjs:469` | HIGH | `initialize` → `200` + `mcp-session-id: sess-poisoned` + body `{truncated` → call 1 fails `MCP_MALFORMED`, but call 2 skipped `initialize` and sent `tools/call` with `sess-poisoned` | FIXED — regression tests `iq-mcp-critic-reliability.test.ts:639` (M1) and `:669` (M1b) |
| F-REL-02 — `tools/call` result with `isError:true` (MCP tool execution error) was reported as `{ok:true,data}`, a false success that fed shadow reconciliation with failed-tool payloads | `relay/iq-mcp/adapter.mjs:523-529` | HIGH | HTTP 200 + valid id + `result:{isError:true,content:[{text:"cannot read with <token>"}]}` → adapter returned `ok:true`, data parsed from the error text | FIXED — typed `MCP_TOOL_ERROR` (DEGRADED, message bounded to 500 chars and redacted); test `:418` |
| F-REL-03 — `_acquire` retried a denied token **once**; `maxRateWaitMs` behaved as a single-sleep cap, not a max wait, so a 100-call burst dropped calls even with room to queue (80/100 succeeded; 20 → `MCP_RATE_LIMITED`) | `relay/iq-mcp/adapter.mjs:396-406` | MEDIUM | 100 simultaneous differing `get_candles` with fake clock + `maxRateWaitMs=60000`: only 80 fetches, 20 dropped | FIXED — bounded retry loop (total wait ≤ `maxRateWaitMs`); regression test `:458` asserts 100/100 queued, exactly 60 grants at t=0 then 1/s, `stats.rateLimited === 0` |
| F-REL-04 — `loadHistory` called `readFile` that the import no longer provided (regression landed during concurrent edits): any call without a custom `fsImpl` threw `ReferenceError: readFile is not defined` | `relay/iq-mcp/reconciliation.mjs:27` (restored import); crash at `reconciliation.mjs:790` path | HIGH | `await loadHistory({ path })` with no `fsImpl` (the shadow persistence read path) → unhandled `ReferenceError` | FIXED — existing test `iq-mcp-reconciliation.test.ts:288-309` plus surface test `:858` exercise the real-fs path |
| F-REL-05 — public error envelope drops `rpcCode`/`status` (`_transportFail` → `_fail` keeps only `code`/`message`), reducing diagnostics for `MCP_RPC_ERROR`/404 | `relay/iq-mcp/adapter.mjs:391-393`, `adapter.mjs:152` | LOW | `error:{code:-32000}` response → `res.error.rpcCode === undefined` | ACCEPTED (typed code/message preserved; no safety impact) |
| F-REL-06 — hostile/absent `Retry-After` (0, negative, non-numeric, HTTP-date) falls back to the 60 s default pause instead of immediate retry | `relay/iq-mcp/adapter.mjs:449-455` | LOW | `429 + Retry-After: 0` pauses the read bucket 60 s | ACCEPTED (bounded by `MAX_RATE_LIMIT_PAUSE_MS = 15 min`; conservative against retry storms; asserted in counterexample 3) |
| F-REL-07 — JSON body without an `id` but with `result` is accepted (id mismatch still rejected) | `relay/iq-mcp/adapter.mjs:144-153` | LOW | server omits `id` on a response → accepted as success | ACCEPTED (required fallback for id-less servers; `id` mismatch, missing `result`, HTML/empty bodies all rejected) |
| F-REL-08 — TTL cache hits are served while health is `AUTH_ERROR`/`UNAVAILABLE` | `relay/iq-mcp/adapter.mjs:570-577` | LOW | `list_assets` cached for 30 s before token revocation → next call returns `ok:true, cached:true` despite `AUTH_ERROR` | ACCEPTED (bounded TTL by design, fail-soft; `get_candles`/`invokeTool` are never cached) |
| F-REL-09 — shadow failure envelope omits `persisted` (undefined, not null) while success always carries it | `relay/iq-mcp/shadow.mjs` `#failRun` | INFO | `runOnce()` MCP down → `result.persisted === undefined` | ACCEPTED (documented via test `:589`; consumers use `?.`) |

## Untested exports found (item 9) — 18 total, all now covered

| Module | Exports with **no** test before this pass | New coverage (test line) |
|---|---|---|
| `adapter.mjs` | `PROTOCOL_VERSION`, `CLIENT_NAME`, `CLIENT_VERSION`, `IQ_MCP_PRODUCTS`, `MAX_CACHE_ENTRIES`, `TokenBucket`, `default` | `:787`, `:800`, `:731` |
| `reconciliation.mjs` | `AVAILABILITY_STATES`, `DEFAULT_MAX_HISTORY_BYTES`, `DEFAULT_MAX_HISTORY_RECORDS`, `assetMarketType`, `normalizeInternalAccount`, `normalizeMcpAccount` | `:858` |
| `shadow.mjs` | `DEFAULT_INTERVAL_MS`, `DEFAULT_JITTER_MS`, `DEFAULT_TIMEOUT_MS`, `default` | `:886`, `:731` |
| `llm-guard.mjs` | `default` | `:731` |
| `security.mjs` | — (all previously covered) | — |

Untested *behaviors* also closed: `persist:false`, `start({immediate:true})`,
`OFFICE_TIMEOUT`, `OFFICE_MALFORMED` (HTML and `null`), `IQ_MCP_TOKEN_FILE`
(and missing file → `MCP_NO_TOKEN` with zero fetches), `getPayout()`/`getMarketStatus()`
all-asset projections, `MCP_NO_PRACTICE_BALANCE`, non-JSON tool text payload, cache-key
argument separation. The inventory test `:731` fails whenever a new export appears
without an accompanying test (exact `Object.keys` per module).

## Mutation gaps (item 10)

Three mutations the **pre-existing 119-test suite does not catch** (verified: all 119
passed with all three mutations applied simultaneously), each now killed by a new test:

| Mutation | Why the old suite missed it | New killer test (fails under mutation) |
|---|---|---|
| M1 — remove the adoption boundary in `_singleRpc`: `if (sessionId) this.sessionId = sessionId` before status/body validation (pre-fix code) | no legacy test sends `mcp-session-id` on a failed/malformed response | `:639` M1 (malformed init + header → no session; next call re-initializes) and `:669` M1b (503 + header → no session) |
| M2 — delete the expiry check in `_cacheGet` (serve cache entries forever) | legacy cache tests call twice at the same fake instant and only assert cache size | `:680` M2 (advance clock past 30 s TTL → second `list_assets` must refetch, `cached:false`) |
| M3 — neutralize the JSON-body id check (`String(message.id) !== String(id)` → `false`) | the only wrong-id test used `text/event-stream` (different code path); no JSON wrong-id test existed | `:363` wrong JSON id → `MCP_MALFORMED`, `ok:false` (never a false success) |

Two additional mutations closed as bonus: M4 hardcoded account mode (`:711`, balances-only
derivation PRACTICE/REAL/MIXED/UNKNOWN) and M5 cache key without tool args
(`:697`, `getSettlement(10)` vs `getSettlement(20)` must issue two fetches).

No zero-assertion or tautological tests were found in the `iq-mcp` suite
(`it` vs `expect` audit; empty-body scan and `expect(true)`/`expect()` scan clean).

## Counterexample coverage (items 1–8)

| # | Counterexample | Tests |
|---|---|---|
| 1 | Timeout mid-`initialize` / mid-`tools/call`; no partial session reused; health DEGRADED | `:188`, `:217` |
| 2 | 401 after a working session → `AUTH_ERROR`, exactly 1 fetch per call, no retry storm | `:246` |
| 3 | Hostile `Retry-After` (0, −5, non-numeric, HTTP-date, 31536000) → finite, ≤15 min, recovers | `:276` (`it.each`, 5 cases) |
| 4 | 5xx burst → capped retries, UNAVAILABLE, then CONNECTED on the next run (adapter + shadow) | `:314`, `:334` |
| 5 | Malformed JSON-RPC: wrong id, missing result, error object, `isError`, HTML, empty, truncated SSE | `:363`–`:418` |
| 6 | Same-asset in-flight dedup (1 fetch); 100 concurrent differing reads queue under 60 burst + 1/s | `:433`, `:458` |
| 7 | 404 session expiry → re-init once + retry once; persistent 404 stays bounded | `:491`, `:527` |
| 8 | Offline fetch → `{ok:false}`, UNAVAILABLE, never throws; shadow isolated (incl. throwing adapter) | `:558`, `:589`, `:623` |
