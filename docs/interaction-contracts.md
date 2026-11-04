# Interaction contracts

How things in a world become interactive. Everything below is domain-neutral unless marked otherwise.
A new world (an office, a library) uses the same contracts with its own map objects and data.

## 1. Map objects (Tiled object layer `objects`)

| Type | Shape | Properties | Meaning |
|---|---|---|---|
| `spawn` | point | none | Named arrival point |
| `door` | rect | `targetRoom`, `targetSpawn` | Walk in to change room |
| `npc` | point | `actorId` | Where an actor from the world definition stands |
| `interactable` | rect | `interactableId` | Zone for an interactable defined in the world definition. Give every physical object its own id (each locker, each shelf) so it has its own dialogue. Zones may share an id only when they really are the same thing (two windows with the same view) |
| `seat` | rect | `facing`, `sitX`, `sitY` (px), `prompt` (all optional) | Somewhere to sit. The rect is the interaction zone (e.g. desk + chair) and `sitX`/`sitY` is where the player is placed |
| `prop` | rect (any pixel size) | `propId` | Overlay drawn with a texture the host supplies at runtime, e.g. a clock face or a window view |

`scripts/generate-maps.mjs` creates a seat for every chair `c` (zone = desk above + chair, facing up).
It also places props at exact pixel rectangles with `px: [dx, dy, w, h]`.
`validateWorld` rejects broken doors and missing zones, as well as duplicate seat ids and seats inside door zones.

## 2. Proximity and the "!" indicator (engine)

- **Interaction position:** the centre of the player's feet physics body. It equals the sprite position because the
  sprite origin is set to the feet. All distances are in world pixels.
- **Range** (`DEFAULT_PROBE` in `engine/core/interaction.ts`): a probe point 6 px in front of the feet, and candidates within
  8 px of it.
  - Something straight ahead is in reach up to 14 px from the feet, less than one 16 px tile.
  - Sideways, the limit is about 10 px.
  - Things behind the player are never selected.
  - Walls and bodies stop the player 3–6 px from what they touch, so touching is always in range.
- **One target, one indicator:** every candidate has a unique `key` (one per map zone, seat or NPC).
  - The scene keeps the matched candidate, and the indicator is drawn over **that** candidate. It is never looked up by id.
  - Pressing E activates exactly that target.
- **Hysteresis:** the current target wins unless another is 3 px closer. This is preference only: it never extends the range,
  so the target drops the instant it is out of reach.
- **Cleared on:** dialogue, panel, seated, room transition (the target is cleared and the scene restarts), and world switch
  (a new game is created).
- **Decorative objects** (plants) simply have no zone, so they can never show an indicator.
- Regression tests: `tests/unit/interaction.test.ts` and `tests/e2e/indicators.spec.ts`. The e2e spec checks the invariant
  on every sample while walking: visible ⇒ a target within reach, indicator over that zone.

## 3. Interactable definitions (world data)

```ts
{ id, roomId, interaction: { prompt, dialogue?, action? } }
```

- **Inspect**: `dialogue` only (bookshelves, lockers). Hallway lockers and shelves live in `src/worlds/school/hallwayItems.ts`. Lines may contain `{placeholders}` (see §5).
  Every script carries `source: 'prototype_script'` and is badged in the UI.
- **Domain panel**: `action` with a kind registered in `DOMAIN_PANELS`, e.g. `school.openLesson` → LessonPanel.
- **Effect**: `action` with a kind registered as an effect, e.g. `environment.toggleLights`. The effect runs at once and
  may return a short message (shown as a toast). The interaction then ends, so movement resumes immediately.

`tests/unit/panels.test.ts` fails if any action a world can request has neither a panel nor an effect.

## 4. Seats (engine)

```
exploring --interact on a seat--> seated --E / Esc--> exploring
```

- The controller gains mode `seated` with `stand()`, and emits `seat.entered` and `seat.left`. While seated, `canMove()` is false.
  Targets, other interactions and door transitions are ignored while seated.
- The scene snaps the player to the seat, faces `facing`, and restores the exact standing position on `stand`.
- **Sitting frames:** if a texture `<spriteKey>:sit` exists (4 frames: down, left, right, up), the scene uses it.
  The character composer generates one for the player. Characters without one fall back to the standing frame
  with the bottom 5 rows (legs) cropped.

## 5. Props and ambience (engine)

- `handle.setPropTexture(propId, canvas)` sets or updates the texture of every prop with that id. Same-size updates
  are redrawn in place, so a clock can be repainted every minute cheaply.
- `handle.setAmbience({ color, alpha } | null)` sets a full-room tint above the characters and below labels.
- The engine knows nothing about clocks, windows or time. It only draws what it is given.

## 6. Environment layer (`src/environment`, reusable, not engine)

- `malaysiaTime(date)`: MYT is a fixed UTC+8 with no DST, so this is exact epoch arithmetic and is independent of the
  browser's time zone. `formatClockTime` produces "7:42 PM".
- `timeOfDayAt(time, starts?)`:
  - night 19:30–06:59, morning 07:00–11:59, afternoon 12:00–17:59, evening 18:00–19:29
  - Malaysia's sunrise is ~7:00–7:20 and sunset ~7:10–7:30 all year, so 6:00–6:59 is still night.
  - The ranges are a parameter.
- Painters (`props.ts`): `paintClockFace`, `paintWindowView`, `paintLightSwitch` return raw RGBA sized to the tile art they cover.
- `useEnvironment()` (React) bundles:
  - the clock, refreshed every second and re-rendering only when the minute changes
  - per-room lights
  - ambience and prop textures
  - dialogue values `{malaysiaTime}`, `{timeOfDay}` and `{windowView}`
  - the `environment.toggleLights` effect
- Demo / QA override: `?mytime=21:30` pins the clock. Tests use Playwright's `page.clock.setFixedTime`.

## 7. Dialogue placeholders

| Placeholder | Filled by |
|---|---|
| `{playerName}` | saved character |
| `{malaysiaTime}`, `{timeOfDay}`, `{windowView}` | environment layer |

Unknown placeholders are left visible, never silently blanked, and a unit test checks that every placeholder used in
world data is one of these.
