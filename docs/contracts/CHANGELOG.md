# Contracts changelog

## curriculum-import 1.0.0 — 2026-11-05

First version.
- File kinds: `curriculum`, `lessons`, `exercises`, `documents`, plus a bundle `manifest.json` with SHA-256 integrity.
- Subjects: `addmath` (3472), `math` (1449), `science` (1511); Forms 4–5; KSSM chapter / content standard / learning standard.
- Answer types: `solution_set`, `expression` (`equivalent` / `factored` / `expanded`), `numeric` (tolerance, rounding,
  units), `inequality`, `equation`, `multiple_choice`, `manual`.
- Provenance (`source`) and human review (`review`) on every lesson, exercise and document. Importers don't trust
  `approved` by default.
- Standalone validator (`validate.py`) and an example bundle covering every kind and answer type.
