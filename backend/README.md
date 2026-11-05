# AgentSchool backend (Phase 1)

FastAPI + PostgreSQL service for the SPM curriculum, bulk dataset and document import, and deterministic answer checking
with SymPy. The virtual classroom (repo root) calls it at `/api`.

There is **no AI in this service**. Lessons are served only after a named human approves them, and answers are checked
by SymPy.

## Setup

Requires Python 3.12+ and Docker.

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"      # Windows; use .venv/bin/pip elsewhere
docker compose up -d                          # PostgreSQL 17 on 127.0.0.1:5433 (dev + test databases)
.venv/Scripts/agentschool db upgrade
```

Configuration comes from environment variables with the `AGENTSCHOOL_` prefix, or `backend/.env`:

| Variable | Default |
|---|---|
| `AGENTSCHOOL_DATABASE_URL` | `postgresql+psycopg://agentschool:agentschool-dev@127.0.0.1:5433/agentschool` |
| `AGENTSCHOOL_CONTRACTS_DIR` | `../docs/contracts/curriculum-import/v1` |
| `AGENTSCHOOL_CORS_ORIGINS` | the Vite dev and preview origins |
| `AGENTSCHOOL_VERIFIER_WORKERS` / `AGENTSCHOOL_VERIFIER_TIMEOUT_SECONDS` | `2` / `5.0` |

The dev password above is for the local container only.

## Operating it

```bash
agentschool validate seed/pilot-lesson                              # contract check, no database
agentschool import seed/pilot-lesson --operator "Your Name" --dry-run
agentschool import seed/pilot-lesson --operator "Your Name"
agentschool pending                                                 # what still needs review
agentschool review lesson addmath-f4-c02-l01 --status approved --reviewer "Your Name" --with-exercises
agentschool serve                                                   # http://127.0.0.1:8010, docs at /docs
```

The API defaults to port **8010**, because 8000 is often taken by other local projects. The classroom's Vite proxy
follows `AGENTSCHOOL_API_URL` (default `http://127.0.0.1:8010`).

**Datasets** follow the versioned contract in [`docs/contracts`](../docs/contracts). Rules applied on import:
- An import is one transaction: the whole bundle or nothing.
- Imports are idempotent.
- A new revision keeps the old one in `content_revisions`.
- `approved` in a file is ignored unless you pass `--trust-approvals`.

## API (v1)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/health` | database, verifier version, counts |
| GET | `/api/v1/subjects` · `/api/v1/subjects/{id}/curriculum?form=4` | chapter → content standard → learning standard |
| GET | `/api/v1/lessons?subject=&form=&chapter=` · `/api/v1/lessons/{id}` | **approved only**. Unapproved exercises are withheld and counted |
| POST | `/api/v1/exercises/{id}/attempts` `{answer, client_id?}` | SymPy verdict: `correct` / `incorrect` / `invalid_input` / `not_verifiable`. Each attempt is stored. The worked solution is returned only after a correct answer |
| GET | `/api/v1/documents/search?q=&subject=` | Postgres full-text search over approved, full-text documents |

Answers, expected values, worked solutions and common mistakes are never in a GET response. A test scans every lesson
payload to check this.

## How verification works

`src/agentschool_api/verification/`:

- **`parsing.py`** turns student text into SymPy safely. SymPy's parser evaluates Python, so input first passes:
  - normalisation (Unicode `−`, `×`, `√`, `π`, `≤` …)
  - a strict token whitelist: numbers, declared variables, a fixed list of functions and operators
  - limits on length, digits, nesting and exponents (`9^9^9` is refused)
  - an unevaluated structural check, before anything is evaluated
- **`verify.py`** handles the seven answer types of the contract. It compares meaning: solution sets in any order,
  factored vs expanded form, units, rounding, sets of reals for inequalities, and equations up to a non-zero multiple.
  The same readers match `common_mistakes` for targeted feedback.
- **`sandbox.py`**: the API runs every check in a worker process with a hard timeout (default 5 s). A stuck worker is
  killed and replaced.

The importer self-checks every exercise:
- the expected answer must verify as correct
- each common mistake must parse and be wrong

## Tests

```bash
docker compose up -d
.venv/Scripts/python -m pytest
```

The tests use the separate `agentschool_test` database (override with `AGENTSCHOOL_TEST_DATABASE_URL`). The schema is
built by the real Alembic migrations, and one test fails if the models and migrations drift apart. If the database is
down, the run stops with a clear message rather than skipping.

### Full-stack check (classroom → API → PostgreSQL → SymPy)

```bash
export AGENTSCHOOL_DATABASE_URL=postgresql+psycopg://agentschool:agentschool-dev@127.0.0.1:5433/agentschool_test
agentschool db upgrade && agentschool import seed/pilot-lesson --operator e2e
agentschool review lesson addmath-f4-c02-l01 --status approved --reviewer "automated e2e test (not a real review)" --with-exercises
agentschool serve &
cd .. && AGENTSCHOOL_FULLSTACK=1 npx playwright test fullstack
```

This approves content in the *test* database only. Real approvals belong to a named teacher in the real database.

## Known limitations (Phase 1)

- **No accounts and no auth.** Attempts carry an anonymous browser id, there is no rate limiting, and the service is
  meant for localhost only.
- **PDFs need extractable text:** scanned PDFs are not OCR'd. Document search is keyword search (`simple`
  configuration), with no embeddings yet.
- **Units:** they're compared as normalised strings, with accepted spellings listed in the data. There is no unit
  conversion (`km h^-1` is not converted to `m s^-1`).
- **Equivalence fallback:** when SymPy can't simplify an expression comparison, it falls back to numeric spot checks
  at fixed rational points.
- **Placeholder codes:** the pilot lesson's curriculum codes are placeholders until the curriculum research dataset
  replaces them.
