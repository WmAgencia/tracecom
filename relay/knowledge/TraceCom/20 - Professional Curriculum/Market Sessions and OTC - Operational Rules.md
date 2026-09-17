---
title: Market Sessions and OTC - Operational Rules
topic: sessions-otc
category: PLAYBOOK
sourceIds: [SRC-IQ-HOURS, SRC-IQ-OTC]
sourceTier: A
retrievedAt: 1789600000000
availableAt: 1789600000000
confidence: 0.8
status: SOURCE_KNOWLEDGE
tracecomApplicability: ADAPTATION_REQUIRED
regimes: [RANGE, TRANSITION]
setups: []
indicators: []
markets: [EURUSD, GBPUSD, USDJPY, EURGBP, GBPJPY]
timeframes: [M1, M5, M15]
tags: [sessions, otc, availability, maintenance]
---

# Market Sessions and OTC - Operational Rules

Operational rules for how TraceCom must treat market sessions and OTC availability. The central claim of this note is that **a theoretical schedule is planning context only; operational availability must come from the live broker connection at decision time**. Facts are cited inline and tagged `[SRC FACT]`; anything that goes beyond the sources is tagged `[INTERPRETATION]` or `[TRACECOM ADAPTATION]`.

## Source key and fetch status

| Key | Source | URL | Fetch status |
|-----|--------|-----|--------------|
| IQ-OTC-1 | IQ Option Official Blog - "What Is OTC Trading: A Guide for Weekend and Off-Hours Traders" (updated Sep 14, 2026) | https://blog.iqoption.com/en/what-is-otc-trading-a-guide-for-weekend-and-off-hours-traders/ | Fetched |
| IQ-OTC-2 | IQ Option Official Blog - "OTC Trading on IQ Option - How to Trade Securities Over-the-Counter" (Jun 30, 2025) | https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/ | Fetched |
| IQ-OTC-3 | IQ Option Official Blog - "How to Trade Indices on IQ Option: A Detailed Guide" (updated Sep 14, 2026) | https://blog.iqoption.com/en/how-to-trade-indices-on-iq-option-a-detailed-guide/ | Fetched |
| IQ-HOURS-1 | IQ Option Official Blog - "After-Hours Trading - Everything You Need to Know" (2019, updated Sep 14, 2026) | https://blog.iqoption.com/en/after-hours-trading/ | Fetched |
| IQ-HOURS-2 | IQ Option Official Blog - "How Many Trading Days Are There in 2026?" (Feb 12, 2026) | https://blog.iqoption.com/en/how-many-trading-days-are-there-in-2026/ | Fetched |
| IQ-HOURS-3 | IQ Option in-platform schedule page (linked from IQ-HOURS-1) | https://iqoption.com/en/trading-hours-and-fees | HTTP 200 but JS-only shell; schedule table NOT extractable in this session |
| INV | Investopedia - "How Global Markets and Time Zones Influence 24-Hour Trading" (Sep 5, 2025) - secondary education | https://www.investopedia.com/how-global-markets-and-time-zones-influence-24-hour-trading-11757445 | Fetched |
| IG | IG - "Forex Trading Hours: Popular Times to Trade Forex" (Dec 10, 2024) - secondary education | https://www.ig.com/sg/trading-strategies/forex-trading-hours--popular-times-to-trade-forex-231120 | Fetched |
| API-ISSUE | Community report: Lu-Yi-Hsun/iqoptionapi GitHub issue #23 (error strings "active is suspended" / "asset is not available at the moment") - NOT official | https://github.com/Lu-Yi-Hsun/iqoptionapi/issues/23 | Fetched (search index + issue text) |
| BINGX | BingX Help Center - "CFD Trading Hours and Holiday Market Schedule" (different broker; analogy only) | https://bingx.com/en/support/articles/17088409395343 | Fetched (search index) |
| T212 | Trading 212 Help Centre - "Why might trading in a specific instrument be suspended/unavailable?" (different broker; analogy only) | https://helpcentre.trading212.com/hc/en-us/articles/360007293218-Why-might-trading-in-a-specific-instrument-be-suspended-unavailable | Fetched (search index) |
| TU | Traders Union - "Best Time To Trade On IQ Option" (third-party; unverified timing claims) | https://tradersunion.com/brokers/binary/view/iqoption/best-time-to-trade/ | Search snippet only; NOT fetched |

Failed fetches (disclosed, and confidence lowered for anything that would have depended on them):

- `https://help.iqoption.com/hc/en-us` - transport error; the official help-center portal was not reachable in this session.
- `https://blog.iqoption.com/en/what-you-need-to-know-about-trading-sessions/` - HTTP 404 (search index still describes the 2016 article; snippet only).
- `https://blog.iqoption.com/en/trading-hours-and-market-holidays/` - HTTP 404.
- `https://blog.iqoption.com/en/market-holidays-and-trading-hours-2026/` - HTTP 404; the 2026 calendar was recovered instead via IQ-HOURS-2.

Because the help center and the in-platform schedule page were not readable, **no exact OTC maintenance times and no per-asset schedule tables are stated in this note** - the sources do not provide them at that precision, and inventing them is prohibited.

## 1. Weekly schedule of exchange (NORMAL) sessions

### 1.1 Verified facts

- `[SRC FACT]` The forex market trades continuously from 5 p.m. ET on Sunday in Sydney until 5 p.m. ET on Friday in New York, across four main sessions: Sydney, Tokyo, London, New York ([INV](https://www.investopedia.com/how-global-markets-and-time-zones-influence-24-hour-trading-11757445)).
- `[SRC FACT]` Session windows in ET: Sydney 5 p.m.-2 a.m.; Tokyo 7 p.m.-4 a.m.; London 3 a.m.-12 p.m.; New York 8 a.m.-5 p.m. ([INV](https://www.investopedia.com/how-global-markets-and-time-zones-influence-24-hour-trading-11757445)).
- `[SRC FACT]` In UK terms: London 8 a.m.-4 p.m. UK time, New York 12 p.m.-9 p.m. UK time, Sydney opens at 9 p.m. UK time ([IG](https://www.ig.com/sg/trading-strategies/forex-trading-hours--popular-times-to-trade-forex-231120)).
- `[SRC FACT]` Overlaps: London/New York 8 a.m.-12 p.m. ET is the deepest-liquidity window; Tokyo/London 3 a.m.-4 a.m. ET; Sydney/Tokyo 7 p.m.-2 a.m. ET ([INV](https://www.investopedia.com/how-global-markets-and-time-zones-influence-24-hour-trading-11757445)). IG gives the London/New York overlap as 1 p.m.-5 p.m. BST, "generally considered the most active and volatile period in the forex market" ([IG](https://www.ig.com/sg/trading-strategies/forex-trading-hours--popular-times-to-trade-forex-231120)).
- `[SRC FACT]` Local session times shift by +/-1 hour with daylight-saving changes in the relevant countries ([IG](https://www.ig.com/sg/trading-strategies/forex-trading-hours--popular-times-to-trade-forex-231120)).
- `[SRC FACT]` On IQ Option, "each asset has its own trading time at which the market is open"; when an asset's market is closed, the traderoom shows the time left until opening, and it is not possible to open or close deals on that asset until then ([IQ-HOURS-1](https://blog.iqoption.com/en/after-hours-trading/)).
- `[SRC FACT]` The platform schedule page (`https://iqoption.com/en/trading-hours-and-fees`, linked from IQ-HOURS-1) shows trading time, overnight fees and spread, and is expressed in **UTC+3** ([IQ-HOURS-1](https://blog.iqoption.com/en/after-hours-trading/)).
- `[SRC FACT]` Indices trade Monday-Friday and "aren't available for trading over the weekend"; schedules differ per index and are found under the asset's Info -> Trading Conditions tab ([IQ-OTC-3](https://blog.iqoption.com/en/how-to-trade-indices-on-iq-option-a-detailed-guide/)).
- `[SRC FACT]` For 2026: U.S. stocks 251 sessions, commodities 251, interest-rate products 257; ten full U.S. market holidays listed; early closes at 1:00 p.m. ET on Jul 2, Nov 27 (Black Friday) and Dec 24 ([IQ-HOURS-2](https://blog.iqoption.com/en/how-many-trading-days-are-there-in-2026/)).
- `[SRC FACT]` "Other countries have their own holidays. Liquidity can drop even when U.S. markets are open" ([IQ-HOURS-2](https://blog.iqoption.com/en/how-many-trading-days-are-there-in-2026/)).

### 1.2 NORMAL schedule rules of thumb

- `[INTERPRETATION]` For the five TraceCom FX majors (EURUSD, GBPUSD, USDJPY, EURGBP, GBPJPY), the tradable NORMAL window is the weekday 24/5 window, with liquidity concentrated in London (EUR/GBP pairs) and the London/New York overlap; USDJPY/GBPJPY additionally see Tokyo-hours activity. This is a composition of the sourced session facts above, not a sourced statement about IQ Option in particular.

## 2. IQ Option OTC assets: availability and semantics

### 2.1 Verified facts

- `[SRC FACT]` OTC means over-the-counter: trading "outside the standard market hours", often a direct deal between trader and broker, without going public ([IQ-OTC-1](https://blog.iqoption.com/en/what-is-otc-trading-a-guide-for-weekend-and-off-hours-traders/), [IQ-OTC-2](https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/)).
- `[SRC FACT]` On IQ Option, OTC assets are available as Binary and Digital Options, and are identified by the "OTC" tag on the asset name ([IQ-OTC-1](https://blog.iqoption.com/en/what-is-otc-trading-a-guide-for-weekend-and-off-hours-traders/), [IQ-OTC-2](https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/)).
- `[SRC FACT]` OTC prices are generated by the platform's own pricing models/algorithms (historical patterns, volatility models, internal liquidity simulation, statistical noise); IQ Option describes it as a "simulated market" that is not linked to real-time exchange data ([IQ-OTC-2](https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/)).
- `[SRC FACT]` Availability window, as officially stated: "available outside normal market hours, especially on weekends - Saturday and Sunday"; the market "becomes available after the traditional markets close on Friday evening", "remains open throughout the weekend", and "typically closes late on Sunday night" before global markets reopen; "times may vary slightly depending on your time zone" ([IQ-OTC-2](https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/)).
- `[SRC FACT]` The authoritative per-asset schedule and conditions are in the platform: click the Info (i) icon next to the asset -> Trading Conditions section ([IQ-OTC-1](https://blog.iqoption.com/en/what-is-otc-trading-a-guide-for-weekend-and-off-hours-traders/), [IQ-OTC-2](https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/), [IQ-OTC-3](https://blog.iqoption.com/en/how-to-trade-indices-on-iq-option-a-detailed-guide/)).
- `[SRC FACT]` OTC carries additional risks listed by the broker itself: non-transparent (internally set) pricing, limited liquidity, wider spreads and possible delays/slippage, vulnerability to volatility spikes, and strategy mismatch (weekday techniques may not carry over) ([IQ-OTC-1](https://blog.iqoption.com/en/what-is-otc-trading-a-guide-for-weekend-and-off-hours-traders/), [IQ-OTC-2](https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/)).
- `[SRC FACT]` The OTC roster is not stable: the Sep-2024 official article lists only three OTC FX pairs (USD/JPY, GBP/JPY, USD/MXN) while the Jun-2025 official article lists dozens of OTC FX pairs; crypto and stock/index lists also differ ([IQ-OTC-1](https://blog.iqoption.com/en/what-is-otc-trading-a-guide-for-weekend-and-off-hours-traders/) vs [IQ-OTC-2](https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/)).

### 2.2 Unverified timing claims (explicitly not adopted)

- `[SECONDARY, UNVERIFIED]` Traders Union states the OTC window as Friday 21:00 GMT to Sunday 21:00 GMT ([TU](https://tradersunion.com/brokers/binary/view/iqoption/best-time-to-trade/)). This was a search snippet only; it is not an IQ Option statement and is **not adopted** as truth here.
- `[SECONDARY, UNVERIFIED]` binaryoptions.com claims a similar Friday-to-Sunday 21:00 UTC window. Same caveat: not official.
- No official source fetched in this session states exact OTC open/close clock times or maintenance windows. Per the task constraint, none are invented below.

## 3. "SUSPENDED" vs "closed": maintenance and suspension semantics

Direct official semantics for an IQ Option "suspended" state were **not found**: the help-center fetch failed, and the fetched official articles use "closed" language rather than "suspended" language. What follows separates evidence from interpretation.

### 3.1 Evidence

- `[SRC FACT]` Official meaning of closed: an asset whose market is closed shows a countdown to reopening and cannot be traded (open or close) until then ([IQ-HOURS-1](https://blog.iqoption.com/en/after-hours-trading/)). This is a **scheduled/structural** state.
- `[SECONDARY, COMMUNITY]` When automated clients attempt to buy an instrument that the broker has disabled, the broker-side API answers with errors such as "Cannot purchase an option (active is suspended)" and "Cannot purchase an option (the asset is not available at the moment)"; in one reported scenario the plain weekday pair is suspended on the weekend while only its OTC counterpart works. Community conclusion: "that is related to which actives IQ Option itself will disable or enable" ([API-ISSUE](https://github.com/Lu-Yi-Hsun/iqoptionapi/issues/23)). Not an official statement, and the API wrapper is unofficial.
- `[SECONDARY, ANALOGY]` A different broker (BingX) explicitly distinguishes **market closed** (scheduled weekend/holiday closure; all operations blocked) from **trading suspended** (special conditions such as abnormal liquidity or contract rollover; e.g., reduce-only, new positions rejected) ([BINGX](https://bingx.com/en/support/articles/17088409395343)). Trading 212 similarly suspends instruments for compliance/regulatory/exchange reasons ([T212](https://helpcentre.trading212.com/hc/en-us/articles/360007293218-Why-might-trading-in-a-specific-instrument-be-suspended-unavailable)). The closed-vs-suspended pattern is therefore documented across venues, though not by IQ Option in any fetched page.

### 3.2 Interpretation (TraceCom position)

- `[INTERPRETATION]` **SUSPENDED is a broker-side current-state flag meaning "temporarily unavailable right now" - it is NOT equivalent to "closed until the scheduled reopen time".** A suspended instrument may become tradable again at an arbitrary moment with no advertised timestamp; a closed instrument has a scheduled reopen (often shown as a countdown). A suspension can also occur while the theoretical schedule says the asset should be open (e.g., maintenance, risk event, liquidity protection, venue outage). The converse is not claimed: "suspension" is not known to mean permanent delisting on IQ Option.
- `[INTERPRETATION]` OTC maintenance windows exist in practice (platforms do pause assets), but because no fetched official source states IQ Option's exact OTC maintenance times, TraceCom must assume **no maintenance timetable** and rely on observed state transitions instead.
- `[INTERPRETATION]` The only authoritative statement of current availability is the live asset state exposed by the broker connection (see Section 4). Anything else - blog text, third-party articles, cached lists, past observations - is context.

## 4. Why a theoretical schedule must NOT be the source of truth

- `[TRACECOM ADAPTATION]` A calendar can never answer "can I open a position on EURUSD-OTC right now?" because:
  1. **OTC timing is intentionally approximate in public sources.** The official wording is "Friday evening -> late Sunday night", times "may vary slightly" by time zone, and per-asset truth lives only inside the platform's Trading Conditions panel ([IQ-OTC-2](https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/)).
  2. **The asset roster changes.** Official OTC lists changed materially between the Sep-2024 and Jun-2025 articles ([IQ-OTC-1](https://blog.iqoption.com/en/what-is-otc-trading-a-guide-for-weekend-and-off-hours-traders/) vs [IQ-OTC-2](https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/)); a schedule computed from any snapshot list will silently reference instruments that no longer exist or miss new ones.
  3. **Suspensions happen outside any schedule** (Section 3.2), including maintenance and protective halts, with no public timetable.
  4. **Time bases disagree.** The official schedule page is UTC+3 ([IQ-HOURS-1](https://blog.iqoption.com/en/after-hours-trading/)), while session literature is in ET/UTC/UK time, and DST shifts windows by an hour ([IG](https://www.ig.com/sg/trading-strategies/forex-trading-hours--popular-times-to-trade-forex-231120)). Converting wrongly yields an hour of false "open" every DST transition.
  5. **Exchange holidays are country-specific.** U.S. holidays are only one piece; other markets keep their own calendars ([IQ-HOURS-2](https://blog.iqoption.com/en/how-many-trading-days-are-there-in-2026/)).
- `[SRC FACT, SUPPORTING]` IQ Option itself tells its readers to verify the platform's Trading Conditions for each asset, and tells systems people to "make sure your platforms, alerts, and automated tools reflect the correct holiday schedule" ([IQ-OTC-2](https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/), [IQ-HOURS-2](https://blog.iqoption.com/en/how-many-trading-days-are-there-in-2026/)).

### 4.1 Operational status gates (must come from the broker connection, at decision time)

`[TRACECOM ADAPTATION]` Before any order intent is emitted, TraceCom must resolve, from the live connection, all of the following for the exact instrument being traded:

1. **Instrument present** - the symbol exists in the broker's current instrument list (NORMAL and OTC listed separately).
2. **Not suspended** - the instrument's current broker state is active, not suspended/disabled; treat any "suspended"/"unavailable" signal as a hard block.
3. **activeId resolvable** - the platform-level identifier for the symbol resolves successfully; an unresolvable or stale activeId invalidates the instrument for this cycle.
4. **Payout/expiration available** - a valid payout exists and allowed expiration(s) include the intended horizon; a zero/missing payout or absent expiration means "unavailable", regardless of presence in a list.
5. **Subscription healthy** - the price subscription for that instrument is confirmed and ticking (not stale); no trading decisions on a stream that is not provably current.

If any gate fails: **do not trade, do not retry blindly, mark the instrument unavailable for that cycle, and re-evaluate on the next broker refresh.**

## 5. Implications for the automated system

- `[TRACECOM ADAPTATION]` **Never cache availability as truth.** Any cached instrument/status/payout data is a projection with a timestamp, usable for planning or ranking, never as authorization to trade. Authorization is re-derived from the connection at decision time.
- `[TRACECOM ADAPTATION]` **Always reflect the latest broker state.** Reconcile after (re)connect and after any error; on a suspension of an instrument with pending intents, drop those intents rather than queueing blind retries; surface the state transition in logs/audit so session behavior can be reviewed later.
- `[TRACECOM ADAPTATION]` **NORMAL and OTC are fully separated.** Same base symbol, different instrument: EURUSD and EURUSD-OTC must have separate identifiers, separate subscription books, and - critically - **separate performance statistics and strategy validation**. The broker itself states that weekday strategies may not carry over to OTC and that OTC pricing is not linked to real exchange data ([IQ-OTC-2](https://blog.iqoption.com/en/otc-trading-on-iq-option-how-to-trade-securities-over-the-counter/)). No silent substitution: if NORMAL EURUSD is closed, the system must not fall back to EURUSD-OTC (or vice versa) unless a strategy explicitly declares OTC suitability and is validated on OTC data.
- `[TRACECOM ADAPTATION]` **Sessions are context, not signals.** For TraceCom, closure/suspension boundaries are `TRANSITION`-flavored context; the weekend OTC regime is treated as `RANGE`-flavored until evidence says otherwise. This note adds no setups and no indicators; it gates *whether* existing logic is allowed to run on an instrument at a given moment.
- `[TRACECOM ADAPTATION]` **Audit each decision with its availability basis.** Record which gate(s) were checked, the observed broker state, and the timestamp, so post-hoc analysis can distinguish strategy error from availability error.

## 6. Confidence and gaps

- Overall confidence 0.80 (as set in the frontmatter): OTC availability semantics, the "OTC tag" identification and the calendar facts are directly backed by official IQ Option pages fetched in full; the session-window facts come from two independent reputable secondary sources that agree on structure.
- Lower-confidence areas: (a) exact OTC open/close and maintenance times - not published in any fetched source, therefore intentionally absent here; (b) the precise semantics of the broker's "suspended" state - supported by community and analogous-broker evidence, not by an official IQ Option gloss (help center unreachable, schedule page JS-only).
- Recommended follow-up when access improves: fetch the per-asset Trading Conditions schedule from a logged-in traderoom session and the official help-center article on asset availability, then reconcile Sections 2 and 3 against observed live states.

## 7. Source-backed vs interpretation - quick ledger

| Claim | Status |
|-------|--------|
| Forex 24/5, Sun 5 p.m. ET -> Fri 5 p.m. ET; session windows and overlaps | Source-backed (INV, IG) |
| Each asset has its own schedule; closed assets show a countdown and cannot be traded | Source-backed (IQ-HOURS-1) |
| Platform schedule page is UTC+3, shows fees/spread | Source-backed (IQ-HOURS-1); page itself not extractable |
| Indices NORMAL trade Mon-Fri only | Source-backed (IQ-OTC-3) |
| 2026 calendar: 251 US sessions, 10 holidays, 3 early closes | Source-backed (IQ-HOURS-2) |
| OTC = off-exchange, internally priced/simulated, tagged "OTC", Fri evening -> Sun night, exact hours in Trading Conditions | Source-backed (IQ-OTC-1, IQ-OTC-2) |
| OTC asset roster changes over time | Source-backed (comparison of IQ-OTC-1 vs IQ-OTC-2) |
| OTC exact clock times / maintenance windows | NOT stated by sources; deliberately not invented |
| "Suspended" = temporarily unavailable, distinct from scheduled closure | Interpretation, supported by community API errors (API-ISSUE) and analogous broker docs (BINGX, T212) |
| Five operational gates (present, not suspended, activeId, payout/expiration, subscription) | TraceCom adaptation |
| Never cache availability as truth; NORMAL/OTC separation; audit basis | TraceCom adaptation |
