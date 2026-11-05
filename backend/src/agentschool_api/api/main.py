"""FastAPI application. Run: `agentschool serve` (or uvicorn agentschool_api.api.main:app).

No `from __future__ import annotations` here: FastAPI resolves dependency
annotations at runtime, and the `DB` alias is local to create_app().
"""
import time
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Engine, func, select, text
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..db import get_engine, session_factory
from ..models import Attempt, Chapter, ContentStandard, Document, Exercise, ItemLearningStandard, LearningStandard, Lesson, Subject
from ..verification.sandbox import VerifierPool
from ..verification.verify import CORRECT, VERIFIER_VERSION
from .schemas import (
    AttemptIn,
    AttemptOut,
    BoardStep,
    ChapterOut,
    ContentStandardOut,
    CurriculumOut,
    ExerciseOut,
    Health,
    LearningStandardOut,
    LessonOut,
    LessonSummary,
    ReviewOut,
    SearchHit,
    SourceOut,
    SubjectOut,
)

APPROVED = "approved"


def create_app(engine: Engine | None = None, verifier: Any | None = None) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.engine = engine or get_engine()
        app.state.sessions = session_factory(app.state.engine)
        owned = verifier is None
        app.state.verifier = verifier or VerifierPool(settings.verifier_workers, settings.verifier_timeout_seconds)
        if owned:
            app.state.verifier.warm_up()
        yield
        if owned:
            app.state.verifier.close()

    app = FastAPI(
        title="AgentSchool API",
        version="0.1.0",
        summary="Curriculum, approved lessons and SymPy answer verification for AgentSchool Phase 1.",
        lifespan=lifespan,
    )
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    def db(request: Request) -> Iterator[Session]:
        session = request.app.state.sessions()
        try:
            yield session
            session.commit()
        except BaseException:
            session.rollback()
            raise
        finally:
            session.close()

    DB = Annotated[Session, Depends(db)]

    @app.get("/api/v1/health", response_model=Health, tags=["meta"])
    def health(session: DB, request: Request) -> Health:
        session.execute(text("select 1"))
        counts = {
            "subjects": session.scalar(select(func.count()).select_from(Subject)) or 0,
            "approved_lessons": session.scalar(select(func.count()).select_from(Lesson).where(Lesson.review_status == APPROVED)) or 0,
            "approved_exercises": session.scalar(select(func.count()).select_from(Exercise).where(Exercise.review_status == APPROVED)) or 0,
            "documents": session.scalar(select(func.count()).select_from(Document)) or 0,
        }
        return Health(status="ok", database="ok", verifier=VERIFIER_VERSION, counts=counts)

    @app.get("/api/v1/subjects", response_model=list[SubjectOut], tags=["curriculum"])
    def subjects(session: DB) -> list[SubjectOut]:
        return [SubjectOut(id=s.id, spm_code=s.spm_code, name=s.name) for s in session.scalars(select(Subject).order_by(Subject.id))]

    @app.get("/api/v1/subjects/{subject_id}/curriculum", response_model=CurriculumOut, tags=["curriculum"])
    def curriculum(subject_id: str, session: DB, form: Annotated[int | None, Query(ge=4, le=5)] = None) -> CurriculumOut:
        subject = session.get(Subject, subject_id)
        if subject is None:
            raise HTTPException(404, "subject not found")
        q = (
            select(Chapter)
            .where(Chapter.subject_id == subject_id)
            .options(selectinload(Chapter.content_standards).selectinload(ContentStandard.learning_standards))
            .order_by(Chapter.form, Chapter.number)
        )
        if form:
            q = q.where(Chapter.form == form)
        return CurriculumOut(
            subject=SubjectOut(id=subject.id, spm_code=subject.spm_code, name=subject.name),
            framework=subject.framework,
            chapters=[_chapter_out(c, with_standards=True) for c in session.scalars(q)],
        )

    @app.get("/api/v1/lessons", response_model=list[LessonSummary], tags=["lessons"])
    def lessons(
        session: DB,
        subject: str | None = None,
        form: Annotated[int | None, Query(ge=4, le=5)] = None,
        chapter: str | None = None,
    ) -> list[LessonSummary]:
        q = select(Lesson).where(Lesson.review_status == APPROVED).order_by(Lesson.id)
        if subject:
            q = q.where(Lesson.subject_id == subject)
        if form:
            q = q.where(Lesson.form == form)
        if chapter:
            q = q.where(Lesson.chapter_id == chapter)
        return [_lesson_summary(row) for row in session.scalars(q)]

    @app.get("/api/v1/lessons/{lesson_id}", response_model=LessonOut, tags=["lessons"])
    def lesson(lesson_id: str, session: DB) -> LessonOut:
        row = session.get(Lesson, lesson_id)
        if row is None or row.review_status != APPROVED:
            # unapproved content is indistinguishable from missing content for students
            raise HTTPException(404, "lesson not found or not approved")
        chapter = session.get(Chapter, row.chapter_id)
        ex_ids = [link.exercise_id for link in row.exercise_links]
        exercises = {e.id: e for e in session.scalars(select(Exercise).where(Exercise.id.in_(ex_ids)))}
        approved = [exercises[i] for i in ex_ids if i in exercises and exercises[i].review_status == APPROVED]
        ls_ids = select(ItemLearningStandard.learning_standard_id).where(ItemLearningStandard.item_kind == "lesson", ItemLearningStandard.item_id == row.id)
        standards = session.scalars(select(LearningStandard).where(LearningStandard.id.in_(ls_ids)).order_by(LearningStandard.code))
        d = row.data
        return LessonOut(
            **_lesson_summary(row).model_dump(),
            chapter=_chapter_out(chapter, with_standards=False),
            learning_standards=[_ls_out(s) for s in standards],
            objectives=d["objectives"],
            board=[BoardStep(**b) for b in d["board"]],
            exercises=[_exercise_out(e) for e in approved],
            exercises_withheld=len(ex_ids) - len(approved),
            source=SourceOut(**{k: d["source"].get(k) for k in ("kind", "author", "citation", "generated_with")}),
            review=_review_out(row),
        )

    @app.post("/api/v1/exercises/{exercise_id}/attempts", response_model=AttemptOut, tags=["exercises"])
    def attempt(exercise_id: str, body: AttemptIn, session: DB, request: Request) -> AttemptOut:
        ex = session.get(Exercise, exercise_id)
        if ex is None or ex.review_status != APPROVED:
            raise HTTPException(404, "exercise not found or not approved")
        started = time.perf_counter()
        verdict = request.app.state.verifier.verify(ex.data["answer"], body.answer, ex.data.get("common_mistakes", []))
        elapsed = int((time.perf_counter() - started) * 1000)
        row = Attempt(
            exercise_id=ex.id,
            exercise_revision=ex.revision,
            client_id=body.client_id,
            answer_text=body.answer,
            status=verdict.status,
            message=verdict.message,
            verifier=VERIFIER_VERSION,
            duration_ms=elapsed,
        )
        session.add(row)
        session.flush()
        worked = ex.data.get("worked_solution") if verdict.status == CORRECT else None
        return AttemptOut(
            attempt_id=row.id,
            exercise_id=ex.id,
            status=verdict.status,
            correct=verdict.correct,
            message=verdict.message,
            interpreted=verdict.interpreted,
            mistake_feedback=verdict.mistake_feedback,
            worked_solution=[BoardStep(**s) for s in worked] if worked else None,
            verifier=VERIFIER_VERSION,
        )

    @app.get("/api/v1/documents/search", response_model=list[SearchHit], tags=["documents"])
    def search(
        session: DB,
        q: Annotated[str, Query(min_length=2, max_length=200)],
        subject: str | None = None,
        limit: Annotated[int, Query(ge=1, le=50)] = 10,
    ) -> list[SearchHit]:
        """Full-text search over approved, full-text documents (Postgres tsvector, 'simple' configuration)."""
        sql = text(
            """
            SELECT c.document_id, d.title, c.heading,
                   ts_headline('simple', c.text, query, 'MaxWords=30, MinWords=10') AS snippet,
                   ts_rank(c.tsv, query) AS rank
            FROM document_chunks c
            JOIN documents d ON d.id = c.document_id,
                 websearch_to_tsquery('simple', :q) AS query
            WHERE c.tsv @@ query AND d.review_status = 'approved' AND d.usage = 'full_text'
              AND (CAST(:subject AS text) IS NULL OR d.subject_id = :subject)
            ORDER BY rank DESC, c.document_id, c.ordinal
            LIMIT :limit
            """
        )
        rows = session.execute(sql, {"q": q, "subject": subject, "limit": limit})
        return [SearchHit(document_id=r.document_id, title=r.title, heading=r.heading, snippet=r.snippet, rank=float(r.rank)) for r in rows]

    return app


# ------------------------------------------------------------------ mappers

def _ls_out(s: LearningStandard) -> LearningStandardOut:
    return LearningStandardOut(id=s.id, code=s.code, description=s.description)


def _chapter_out(c: Chapter, with_standards: bool) -> ChapterOut:
    standards = (
        [ContentStandardOut(id=cs.id, code=cs.code, title=cs.title, learning_standards=[_ls_out(s) for s in cs.learning_standards]) for cs in c.content_standards]
        if with_standards
        else []
    )
    return ChapterOut(id=c.id, form=c.form, number=c.number, title=c.title, content_standards=standards)


def _review_out(row: Any) -> ReviewOut:
    return ReviewOut(status=row.review_status, reviewed_by=row.reviewed_by, reviewed_at=row.reviewed_at)


def _lesson_summary(row: Lesson) -> LessonSummary:
    d = row.data
    return LessonSummary(
        id=row.id,
        revision=row.revision,
        subject=row.subject_id,
        form=row.form,
        chapter_id=row.chapter_id,
        title=d["title"],
        summary=d.get("summary"),
        estimated_minutes=d.get("estimated_minutes"),
    )


def _exercise_out(e: Exercise) -> ExerciseOut:
    d = e.data
    options = d["answer"]["options"] if d["answer"]["type"] == "multiple_choice" else None
    return ExerciseOut(
        id=e.id,
        revision=e.revision,
        prompt=d["prompt"],
        answer_format_hint=d.get("answer_format_hint"),
        marks=d["marks"],
        difficulty=d["difficulty"],
        answer_type=d["answer"]["type"],
        options=options,
        hints=d.get("hints", []),
        review=_review_out(e),
    )


app = create_app()
