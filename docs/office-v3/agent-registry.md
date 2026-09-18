# OFFICE V3 — AGENT REGISTRY

`src/http/public/office-v3/life.js` owns the single registry that maps every
market to exactly one trader and one critic. Rendering-only, PRACTICE only,
zero orders. Built deterministically from the seed (`createLifeSystem(world,
{ seed })` + N `updateLife` calls), refreshed on every update and on access.

## Registry shape

`getAgentRegistry(life)` returns a plain object keyed by `marketKey`:

```js
{
  "ASSET0:NORMAL": {
    marketKey: "ASSET0:NORMAL",
    traderAgentId: "trader:ASSET0:NORMAL",
    criticAgentId: "critic:ASSET0:NORMAL",
    currentLocation: "desk" | "social" | "walking",  // aggregate of both agents
    state: "OPEN" | "CLOSED",                        // resolved market presence
    traderLocation: "desk" | "social" | "walking",
    criticLocation: "desk" | "social" | "walking",
    stationId: "station:ASSET0:NORMAL"
  },
  // ... one entry per station/market
}
```

`getAgentLocations(life)` returns a plain object keyed by `agentId`:

```js
{
  "trader:ASSET0:NORMAL": {
    agentId, role, marketKey, stationId,
    location: "desk" | "social" | "walking",
    zoneId: "zone:cafe" | null,     // social zone the agent is inside (social only)
    zoneKind: "kitchen" | null,
    spotId: "spot:cafe:1" | null,   // reserved seat, if any
    atDesk, working, traveling,
    x, y
  }
}
```

Location classification is exclusive, one value per agent per frame:
`atDesk` → `desk`; `traveling` → `walking`; settled → `social`.

## Invariants (enforced in code)

Validated by `validateLifeInvariants(life)` and enforced by
`refreshAgentRegistry(life, { enforce: true })` (called by every
`updateLife`, `getAgentRegistry`, `getAgentLocations`, `setPresence` path):

1. **1 market = 1 trader + 1 critic.** Every market has exactly two agents, one
   of each role; every `agentId` (`trader:<marketKey>` / `critic:<marketKey>`)
   is globally unique. Duplicated markets/ids throw.
2. **One location per agent.** An agent can never be at its desk and at a
   coffee/sofa/pool seat in the same frame (`atDesk` + `spotId` is a violation;
   `working` without a desk is a violation; a working agent inside a social zone
   is a violation).
3. **OPEN → BOTH seated on their own desk.** Closed/unavailable → desk empty,
   those same two agents settle in social areas (zone/loiter tiles).
4. **Reopen → walk back, no teleport.** When the return path is momentarily
   unavailable the agent waits and retries after a 400 ms cooldown; it is never
   snapped onto the chair.
5. **Rendered exactly once per frame.** `drawAgents` keeps a per-frame
   `Set` of drawn ids; a repeated `agentId` is an invariant violation and the
   second draw is skipped (`life.lastDrawStats = { drawn, unique, duplicates }`).

Enforcement mode: strict/test mode (`createLifeSystem(world, { strict: true })`,
`NODE_ENV === "test"` or `globalThis.__OFFICE_V3_STRICT__ === true`) **throws**.
Production degrades safely: one `console.warn` per violation code
(`life.invariantWarnings`), renderer keeps running.

## Hook for other modules

```js
import { getAgentRegistry, getAgentLocations, setMarketPresence } from "./life.js";

const registry = getAgentRegistry(lifeSystem);          // marketKey -> pair + location
const entry = registry[station.marketKey];
if (entry.state === "OPEN" && entry.currentLocation === "desk") { /* both seated */ }

const locations = getAgentLocations(lifeSystem);        // agentId -> single location
const atCoffee = locations["critic:ASSET0:NORMAL"]?.zoneKind === "kitchen";

setMarketPresence(lifeSystem, station.marketKey, open); // marketKey-keyed presence override
```

- `setMarketPresence(life, marketKey, open)` — registry-key alias of
  `setPresence`; returns `false` for unknown keys. The pair walks to the new
  location on the next `updateLife`.
- `getAgentStates(life)` also exposes `location` and `zoneId` per agent.
- Backward compatible: `createLifeSystem`, `updateLife`, `drawAgents`,
  `getAgentStates`, `setPresence`, `bindWorld`, `bindAssets`,
  `getSupervisorState` keep their contracts unchanged.
