# ADR-009 — Add Phase 0: reusable 2D virtual-world framework

**Status:** Accepted by the developer, 4 Nov 2026 (amends Frozen Spec v1.0)
**Amends:** Frozen Spec v1.0 §1 ("Not success: … a 2D school game"), §2.1 (2D campus explicitly deferred), §3 ("No default … game engine"), §6 ("No … 2D campus"), §9 step 2 ("Start only with the 0–10 h vertical slice").
**Does not amend:** ADR-001 … ADR-008, the maths verification contract (§4), mastery policy (§5), evaluation protocol (§7) or honest-claims rules (§7.5).

## Context

The frozen spec deliberately excluded a 2D campus so that effort went into verifiable AI engineering. The developer has decided to build, *before* the learning engine, a playable top-down 2D world (React + TypeScript + Phaser + Tiled maps), for two reasons:

1. **Presentation:** a walkable school where a teacher opens a lesson is a stronger first impression than a plain form.
2. **Reuse:** if AgentSchool is abandoned, the same engine should host a 2D office (BizPilot-style) without rewriting movement, collision, maps, NPCs or interaction.

## Decision

- Build a **domain-independent world engine** (`src/engine`) with stable contracts: `WorldDefinition`, `ActorDefinition`, `InteractionDefinition`, `ActionDescriptor`, `SceneTransition`, `WorldEvent`.
- Worlds are **data** (`src/worlds/*`): Tiled maps, spawns, NPC placement, interaction wiring.
- Domain features (`src/domains/*`) are React panels registered by action `kind`. Phaser scenes **never** contain grading, LLM calls or business logic; the engine only emits typed events.
- Ship two worlds: **School** (primary; hallway, classroom, teacher, blackboard, mock lesson) and **Office** (one room, one employee, one mock task) as a reuse test. Office is not BizPilot.
- All dialogue and lesson content in Phase 0 is **mock data labelled "Prototype script — not AI-generated"**. The exercise panel **records** answers but does **not grade** them; the verified grader arrives with the learning engine.
- Enforced by tests: the engine may not import `worlds/` or `domains/`, and may not contain domain vocabulary.

## Consequences

### Effort (planning estimate)

| Item | Hours |
|---|---:|
| Engine core (state machine, movement, interaction, Tiled parsing, validation) + tests | 6 |
| Phaser scene (maps, collision, doors, NPCs, camera, animation, resize) | 7 |
| Original pixel-art generation + maps | 3 |
| React layer (dialogue, prompt, panel registry, lesson/exercise + KaTeX, office task, dev selector) | 5 |
| Playwright e2e + clean-clone check | 3 |
| Docs (architecture, assets, this ADR) | 1 |
| **Phase 0 total** | **~25** |
| Later: embed the real maths workspace inside the lesson panel (replaces the mock panel; API calls stay in React) | +4–6 |

**Release 1 total moves from ~80 h to ~110 h.** The ~2 h buffer in v1.0 cannot absorb this. All gates shift by Phase 0's actual hours: **G1 ≈ 45 h, G2 ≈ 70 h, G3 ≈ 95 h**.

### Risks and rules

- **Main risk: game polish delays verifier work.** The portfolio's core evidence is still the verifier, the step checker and the A/B/C evaluation. **Rule:** Phase 0 is timeboxed at **30 h**. Anything past that (extra rooms, animations, pathfinding, customisation, sound) waits until after G3.
- **Résumé wording:** the 2D world is presentation. It must not be described as AI capability, and no claim may suggest the mock teacher is model-driven.
- **Spec v1.0 "Not success" list:** "a 2D school game" stays *not success on its own*. Phase 0 counts only as the presentation layer of a release that still meets §1 items 1–6.
- The learning-engine phase starts from the v1.0 0–10 h vertical slice unchanged (backend, E1–E6). Phase 0 adds no FastAPI, PostgreSQL, LangGraph or LLM calls.

### Exit criteria for Phase 0

The 10 acceptance criteria in the Phase 0 brief, verified by Vitest (engine/world contracts) and Playwright (walk, collide, door, interact, lesson + KaTeX, answer, close, resume, office world).
