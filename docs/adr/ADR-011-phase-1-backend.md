# ADR-011 — Phase 1 backend: curriculum database, import contract, SymPy verification

**Status:** Proposed (implemented on `feature/phase1-backend`; awaiting the developer's acceptance)
**Context:** ADR-009 deferred the learning engine to after Phase 0. Phase 1 starts it. The Frozen Spec v1.0 and
ADR-001…008 are not in this repository, so this ADR records the decisions taken without them. Where they conflict,
they win, and this ADR should be amended.

## Decisions

1. **FastAPI + PostgreSQL 17 + SQLAlchemy 2 + Alembic**, in `backend/`, separate from the frontend build. Local
   PostgreSQL runs in Docker on port 5433, with dev and test databases.
2. **Versioned import contract** (`docs/contracts/curriculum-import/v1`, contract 1.0.0) is the boundary between
   dataset authors (e.g. Codex on `research/spm-curriculum`) and the backend.
   - The JSON Schemas and the standalone `validate.py` are the single source of truth.
   - The importer loads that same validator file rather than keeping a copy.
3. **Human review gates students.** Only `approved` lessons and exercises are served.
   - Approvals need a named reviewer, are logged in `review_events`, and are enforced by a database CHECK constraint.
   - Approvals inside dataset files are not trusted unless the operator passes `--trust-approvals`, so AI-drafted
     data cannot approve itself.
4. **Deterministic verification with SymPy, not an LLM.**
   - Seven answer types, compared by meaning.
   - Input is whitelisted and size-limited before SymPy sees it, because `parse_expr` uses `eval`.
   - Checks run in a worker process with a hard timeout.
   - Every imported exercise is self-checked: the expected answer passes and each listed mistake fails.
5. **Imports are transactional, idempotent and revisioned.**
   - Same id and revision: unchanged.
   - Higher revision: updated, with history kept.
   - Same revision with different content: error.
6. **Bulk documents**: Markdown, plain text and text PDFs are extracted, chunked by heading, and indexed with Postgres
   full-text search (`simple` configuration, because content is mixed BM/EN). `metadata_only` documents store no text,
   for sources we may cite but not copy.
7. **Classroom connection:**
   - The teacher and blackboard open lesson `addmath-f4-c02-l01` from the API.
   - If the lesson isn't approved, or the API is unreachable, the classroom falls back to the Phase 0 mock lesson,
     clearly labelled as unchecked.
   - Answers are labelled "checked by SymPy (not AI)", and AI-drafted content is badged as such even when approved.
8. **The API defaults to port 8010**, because port 8000 is used by other local projects on the developer's machine.

## Consequences

- Real lessons appear in the classroom only after a teacher runs `agentschool review … --status approved`. This is
  intentional.
- **Out of scope for Phase 1:** authentication, rate limiting and deployment. The API is for localhost. No AI agents
  and no LangGraph. Mastery and evaluation (spec §5 and §7) are not implemented yet.
