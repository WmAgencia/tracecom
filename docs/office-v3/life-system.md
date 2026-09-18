# OFFICE V3 — LIFE SYSTEM

`src/http/public/office-v3/life.js` — pure ESM, no DOM. Two agents per station
(trader + critic) plus one supervisor. All motion is grid-based and deterministic
given a seed. No orders, practice/visual only.

## Presence mapping

A station is OPEN only when it is really tradable. `isStationOpen` resolves, in order:

1. explicit boolean `station.isOpen`;
2. `station.enabled === false` → closed;
3. `availability === "OPEN"` → open; any other non-empty availability → closed;
4. fallback `station.enabled !== false`.

| Station state | Desk | Agents |
| --- | --- | --- |
| OPEN | trader + critic at the desk | pose `work` / `sit`, `working: true` |
| CLOSED / SUSPENDED / DISABLED / NOT_OFFERED / UNKNOWN | empty | walk to social areas, `working: false` |

`setPresence(life, stationId, active)` stores an override in `life.presence`
(accepts `station.id` or `marketKey`) without mutating the station object, so
`world.js` stations may be frozen or getter-backed. Reopening a station makes its
two agents **walk** back to their desk — never teleport.

## Agent states

`getAgentStates(life)` returns `{ id, role, stationId, marketKey, state, pose, x, y, home, assignment, spotId, activityKind, atDesk, working, traveling, idle, pathLength }`.

| state | pose | when |
| --- | --- | --- |
| `WORK` | `work` | trader seated at an OPEN desk |
| `SIT` | `sit` | critic seated at an OPEN desk, or on a lounge sofa |
| `WALK` | `walk` | following an A* path (`traveling: true`) |
| `COFFEE` | `coffee` | café stool / kitchen |
| `POOL` | `pool` | pool table seat |
| `TALK` | `talk` | meeting/social table |
| `OBSERVE` | `observe` | research desk or the supervisor |
| `IDLE` | `idle` | loitering inside a social zone |

Poses are the frozen `assets.js` set: `idle, walk, sit, work, talk, coffee, pool, observe`.

## Pathfinding

- World pixels, `TILE = 16`. Grid size = `ceil(worldWidth/TILE) x ceil(worldHeight/TILE)` (2560x1600 → 160x100).
- 4-directional A* (`findTilePath`) with a binary min-heap; steps are always
  orthogonally adjacent, so a path never crosses a blocked tile.
- Blocked cells: one-tile world border, every desk rect, and every furniture
  collider (`worldState.colliders` / `obstacles` / `station.desk`).
- Agents move at `AGENT_SPEED = 84 px/s` toward tile centres, so motion is slow
  and natural and there is no teleporting: a position only changes along the path.
- Destinations are snapped to walkable tiles. If a home/spot tile is blocked the
  nearest walkable tile is used (`nearestWalkableTile`).
- Social destinations: lounge sofas, pool table, café/kitchen, meeting area and
  research area.

## Occupancy

`LifeOccupancy` keeps a reservation list per spot. A seat is only handed out while
`reservations.length < capacity`, so a sofa with capacity 3 never holds 10 agents.
Agents that cannot get a seat **loiter** on walkable tiles inside a social zone
(loiter tiles are unlimited and always inside the zone rect). Every seat is
released when the agent goes back to a desk or switches activity.

## Supervisor

One supervisor walks a patrol route derived from the desk rows (`worldState.patrol`
or the fallback rows). It A*-walks to a waypoint, then runs the
`WALK → OBSERVE` cycle (900 ms observing) before advancing to the next waypoint,
stopping behind the desks to observe and continuing. Exposed through
`getSupervisorState(life)`.

## Determinism

State transitions never call `Math.random`. The seed only feeds
`mulberry32(hashString(seed))` and per-agent hashes used for seat/loiter choice,
so `createLifeSystem(world, { seed })` followed by N `updateLife` calls produces
byte-identical `getAgentStates` output.

## world.js / assets.js integration

Both are imported lazily through a guarded computed `import()`; when the files are
absent the module keeps working with the local fallback world
(`buildFallbackWorldState`) and a minimal character drawer. When present,
`drawAgents(ctx, life, camera)` uses `assets.js#drawCharacter`, and `camera.js`
prefers `world.js#hitTestStation` for hover/click.

## Public API

- `createLifeSystem(worldState, options)` / `updateLife(life, dtMs)`
- `getAgentStates(life)` / `setPresence(life, stationId, active)`
- `drawAgents(ctx, life, camera)` / `getSupervisorState(life)`
- `buildFallbackWorldState(officeJson, options)` (stub when `world.js` is missing)

`camera.js` exports `createCamera`, `applyCamera`, `updateCamera`, `zoomToDesk`
(400 ms smooth), `resetCamera`, `screenToWorld`, `worldToScreen`, `handleWheel`,
`handleDragStart/Move/End`, `handleClick`, `handleHover`. Zoom is clamped to
`[0.25, 4]`; there is **no destructive auto-FIT** — `autoFit` stays `false` and
`resetCamera` only returns to the overview origin.
