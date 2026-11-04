# AgentSchool — Phase 0 world prototype

A playable top-down 2D school (hallway → classroom → teacher → mock maths lesson) built on a
**domain-independent world engine**, plus an Office world that reuses the same engine unchanged.
See [ADR-009](docs/adr/ADR-009-reusable-2d-world-phase-0.md) for why Phase 0 exists and its timebox.

> **Everything interactive is mock content.** Dialogue and lessons are hand-written prototype
> scripts (badged *"Prototype script — not AI-generated"* in the UI). Exercise answers are
> **recorded, not graded**. There are no AI agents, no backend and no network calls.

## Run

Requires Node 20.19+ (tested on Node 26 / npm 11).

```bash
npm install
npx playwright install chromium   # once, for e2e tests
npm run dev                       # http://localhost:5173  (?world=office to start in the office)
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) + production build to `dist/` |
| `npm run preview` | Serve `dist/` on :4173 |
| `npm test` | Vitest: engine, world/map contracts, panel registry, React components (jsdom) |
| `npm run test:e2e` | Playwright against the **production build** (builds first) |
| `npm run test:all` | Both |
| `npm run assets` | Regenerate pixel art (needs Python + Pillow) and Tiled maps |

**Controls:** WASD / arrows to move · E or Space to interact · Space/Enter to advance dialogue ·
1–9 to pick a choice · Esc to close.

## Architecture

```
src/
  engine/              domain-independent; may not import worlds/ or domains/ (enforced by tests)
    core/              pure TS: WorldController state machine, event bus, movement,
                       interaction probing, Tiled parsing + world validation
    phaser/            WorldScene (maps, collision, doors, NPCs, camera, animation, resize)
                       and createWorldGame()
  worlds/              data only: WorldDefinitions (rooms, spawns, actors, interaction wiring)
    school/  office/   registry.ts
  domains/             React panels registered by action kind
    school/            LessonPanel (blackboard + exercises, KaTeX), mock lesson data, progress
    office/            TaskPanel (mock checklist)
  app/                 React shell: GameView (boots Phaser, maps engine events to UI state),
                       DialogueBox, prompt, WorldSelector, PanelShell, badges
public/
  assets/              original pixel art (tiles.png, characters/*.png, ui/indicator.png)
  maps/                Tiled 1.10 JSON maps (layers: ground, walls, furniture, objects)
```

Flow: the scene reports targets/doors → `WorldController` changes mode and emits typed
`WorldEvent`s → `GameView` renders a dialogue or looks up `DOMAIN_PANELS[action.kind]` →
the panel calls `onClose` → `controller.endInteraction()` → movement resumes.
Phaser never contains lesson, grading or business logic; React never touches Phaser objects.

### Adding a world

1. Author maps in Tiled (or add a layout to `scripts/generate-maps.mjs`) with tile layers
   `ground`, `walls`, `furniture` and an object layer `objects` containing `spawn`, `door`
   (`targetRoom`, `targetSpawn`), `npc` (`actorId`) and `interactable` (`interactableId`) objects.
   Collision comes from the tileset's `collides` tile property.
2. Write a `WorldDefinition` in `src/worlds/<name>/definition.ts` and add it to `registry.ts`.
3. Register panels for any new action kinds in `src/domains/index.ts`.
   `tests/unit/worlds.test.ts` validates the maps; `tests/unit/panels.test.ts` fails if an action
   has no panel.

## Tests

- **Vitest (45):** movement, interaction probing, controller state machine, both worlds
  validated against their Tiled maps, engine boundary (no imports from or vocabulary of
  domains), panel registry coverage, lesson TeX validity, and jsdom component tests for the
  dialogue, lesson and task panels.
- **Playwright (8):** walk, wall collision, noticeboard dialogue, door transition both ways,
  teacher dialogue → lesson → KaTeX → recorded answer → close → movement resumes → lesson
  resumes, "Maybe later", blackboard, office world via selector and via URL.

E2e tests drive the game with **real keyboard input**. They read state through
`window.__agentWorld` (read-only: mode, room, player snapshot) only to steer and assert.

## Known limits (deliberately out of Phase 0 scope)

- Keyboard only: no touch controls, so the game is viewable but not playable on phones.
- No pathfinding, sound, save files or character customisation (ADR-009 timebox rule).
- Lesson progress lives in `sessionStorage` only.
