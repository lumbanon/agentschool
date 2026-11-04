# Phase 0 implementation review

Compared the Phase 0 README and ADR-009 with base commit `777d621`
(also GitHub HEAD at review time). The base commit contains maps, original
pixel art, world definitions, and the pure engine core. The local checkout
already contained uncommitted implementations of the missing runtime and UI;
these were reviewed and completed as part of this change.

| Required capability | Base commit gap | Completed implementation / evidence |
| --- | --- | --- |
| Runnable React + TypeScript application | No entry point or build configuration | Vite entry point, scripts, lockfile, typecheck and production build |
| Walkable 2D world | No renderer | Generic Phaser scene: movement, collision, animation, camera, resize |
| Hallway and classroom navigation | No runtime door handling | Scene transitions with named spawns; keyboard browser tests in both directions |
| NPC and object interaction | No prompts or dialogue UI | Target indicator, keyboard prompts, scripted dialogue and choices; movement pauses |
| Teacher opens a mock maths lesson | No domain panels | Action registry, lesson blackboard, KaTeX, exercises |
| Record answers and resume | No lesson progress UI/storage | Session progress, explicit ungraded answers, close and resume; malformed progress recovery |
| Reuse without engine changes | No playable Office | Office task panel and world selector; browser tests for switching and direct URL |
| Honest prototype claims | No visible application labels | Prototype source badges and explicit mock/no-grading notices |
| Automated acceptance checks | Only core unit tests | Component tests plus production-build Chromium flows |

The engine remains independent of worlds and domain panels, enforced by tests.
Playwright starts a fresh production preview rather than reusing an unrelated
server. No backend, AI calls, grading, pathfinding, sound, or additional rooms
were added. Phone touch controls remain outside the documented Phase 0 scope.

Validation commands: `npm test`, `npm run build`, `npm run test:e2e`.
