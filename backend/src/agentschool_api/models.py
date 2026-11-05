"""Database schema. Mirrors the curriculum-import contract v1 (docs/contracts)."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Computed,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

REVIEW_STATUSES = ("draft", "pending_review", "approved", "rejected")


class Base(DeclarativeBase):
    pass


def _review_check(table: str) -> CheckConstraint:
    return CheckConstraint(
        f"review_status IN {REVIEW_STATUSES} AND (review_status NOT IN ('approved','rejected') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))",
        name=f"ck_{table}_review",
    )


class ReviewMixin:
    review_status: Mapped[str] = mapped_column(String(20), default="draft")
    reviewed_by: Mapped[str | None] = mapped_column(String(200))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_notes: Mapped[str | None] = mapped_column(Text)


class ContentMixin(ReviewMixin):
    revision: Mapped[int] = mapped_column(Integer)
    #: SHA-256 of the item's canonical JSON (or of the payload, for documents).
    content_hash: Mapped[str] = mapped_column(String(64))
    source: Mapped[dict[str, Any]] = mapped_column(JSONB)
    import_batch_id: Mapped[int | None] = mapped_column(ForeignKey("import_batches.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ------------------------------------------------------------------ curriculum

class Subject(Base):
    __tablename__ = "subjects"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    spm_code: Mapped[str] = mapped_column(String(4), unique=True)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    framework: Mapped[dict[str, Any]] = mapped_column(JSONB)
    chapters: Mapped[list[Chapter]] = relationship(back_populates="subject", order_by="(Chapter.form, Chapter.number)")


class Chapter(Base):
    __tablename__ = "chapters"
    __table_args__ = (UniqueConstraint("subject_id", "form", "number"), CheckConstraint("form IN (4, 5)", name="ck_chapters_form"))
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("subjects.id"))
    form: Mapped[int] = mapped_column(Integer)
    number: Mapped[int] = mapped_column(Integer)
    title: Mapped[dict[str, str]] = mapped_column(JSONB)
    subject: Mapped[Subject] = relationship(back_populates="chapters")
    content_standards: Mapped[list[ContentStandard]] = relationship(back_populates="chapter", order_by="ContentStandard.code")


class ContentStandard(Base):
    __tablename__ = "content_standards"
    __table_args__ = (UniqueConstraint("chapter_id", "code"),)
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    chapter_id: Mapped[str] = mapped_column(ForeignKey("chapters.id"))
    code: Mapped[str] = mapped_column(String(20))
    title: Mapped[dict[str, str]] = mapped_column(JSONB)
    chapter: Mapped[Chapter] = relationship(back_populates="content_standards")
    learning_standards: Mapped[list[LearningStandard]] = relationship(back_populates="content_standard", order_by="LearningStandard.code")


class LearningStandard(Base):
    __tablename__ = "learning_standards"
    __table_args__ = (UniqueConstraint("content_standard_id", "code"),)
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    content_standard_id: Mapped[str] = mapped_column(ForeignKey("content_standards.id"))
    chapter_id: Mapped[str] = mapped_column(ForeignKey("chapters.id"))
    code: Mapped[str] = mapped_column(String(20))
    description: Mapped[dict[str, str]] = mapped_column(JSONB)
    content_standard: Mapped[ContentStandard] = relationship(back_populates="learning_standards")


# ------------------------------------------------------------------ content

class Exercise(ContentMixin, Base):
    __tablename__ = "exercises"
    __table_args__ = (_review_check("exercises"), CheckConstraint("form IN (4, 5)", name="ck_exercises_form"))
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("subjects.id"))
    form: Mapped[int] = mapped_column(Integer)
    answer_type: Mapped[str] = mapped_column(String(30))
    #: The whole exercise as imported (prompt, answer spec, hints, mistakes...). Answers never leave the API.
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)


class Lesson(ContentMixin, Base):
    __tablename__ = "lessons"
    __table_args__ = (_review_check("lessons"), CheckConstraint("form IN (4, 5)", name="ck_lessons_form"))
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    subject_id: Mapped[str] = mapped_column(ForeignKey("subjects.id"))
    form: Mapped[int] = mapped_column(Integer)
    chapter_id: Mapped[str] = mapped_column(ForeignKey("chapters.id"))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    exercise_links: Mapped[list[LessonExercise]] = relationship(order_by="LessonExercise.position", cascade="all, delete-orphan")


class LessonExercise(Base):
    __tablename__ = "lesson_exercises"
    lesson_id: Mapped[str] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), primary_key=True)
    exercise_id: Mapped[str] = mapped_column(ForeignKey("exercises.id"), primary_key=True)
    position: Mapped[int] = mapped_column(Integer)


class ItemLearningStandard(Base):
    """Which learning standards a lesson, exercise or document covers."""

    __tablename__ = "item_learning_standards"
    item_kind: Mapped[str] = mapped_column(String(20), primary_key=True)
    item_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    learning_standard_id: Mapped[str] = mapped_column(ForeignKey("learning_standards.id"), primary_key=True)


class Document(ContentMixin, Base):
    __tablename__ = "documents"
    __table_args__ = (_review_check("documents"), CheckConstraint("usage IN ('full_text','metadata_only')", name="ck_documents_usage"))
    id: Mapped[str] = mapped_column(String(120), primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    document_type: Mapped[str] = mapped_column(String(30))
    language: Mapped[str] = mapped_column(String(2))
    subject_id: Mapped[str] = mapped_column(ForeignKey("subjects.id"))
    form: Mapped[int | None] = mapped_column(Integer)
    media_type: Mapped[str] = mapped_column(String(50))
    usage: Mapped[str] = mapped_column(String(20))
    bundle_path: Mapped[str] = mapped_column(String(300))
    text_chars: Mapped[int] = mapped_column(Integer, default=0)
    chunks: Mapped[list[DocumentChunk]] = relationship(order_by="DocumentChunk.ordinal", cascade="all, delete-orphan")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "ordinal"),
        Index("ix_document_chunks_tsv", "tsv", postgresql_using="gin"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    ordinal: Mapped[int] = mapped_column(Integer)
    heading: Mapped[str | None] = mapped_column(String(300))
    text: Mapped[str] = mapped_column(Text)
    # 'simple' config: no English stemming, so Bahasa Melayu text is indexed the same way
    tsv: Mapped[Any] = mapped_column(TSVECTOR, Computed("to_tsvector('simple', coalesce(heading, '') || ' ' || text)", persisted=True))


class ContentRevision(Base):
    """Previous revisions, kept when a newer revision is imported."""

    __tablename__ = "content_revisions"
    __table_args__ = (UniqueConstraint("item_kind", "item_id", "revision"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    item_kind: Mapped[str] = mapped_column(String(20))
    item_id: Mapped[str] = mapped_column(String(120))
    revision: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    review_status: Mapped[str] = mapped_column(String(20))
    replaced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReviewEvent(Base):
    """Audit log of every review-status change (who approved what, when)."""

    __tablename__ = "review_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_kind: Mapped[str] = mapped_column(String(20))
    item_id: Mapped[str] = mapped_column(String(120))
    revision: Mapped[int] = mapped_column(Integer)
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str] = mapped_column(String(20))
    reviewer: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(Text)
    #: 'cli', 'import' (approval trusted from a dataset) ...
    via: Mapped[str] = mapped_column(String(20))
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[int] = mapped_column(primary_key=True)
    dataset_id: Mapped[str] = mapped_column(String(120))
    dataset_version: Mapped[str] = mapped_column(String(30))
    contract_version: Mapped[str] = mapped_column(String(20))
    manifest_sha256: Mapped[str] = mapped_column(String(64))
    operator: Mapped[str] = mapped_column(String(200))
    trust_approvals: Mapped[bool] = mapped_column(default=False)
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    warnings: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Attempt(Base):
    """One student answer and its verification result."""

    __tablename__ = "attempts"
    __table_args__ = (Index("ix_attempts_exercise", "exercise_id", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    exercise_id: Mapped[str] = mapped_column(ForeignKey("exercises.id"))
    exercise_revision: Mapped[int] = mapped_column(Integer)
    #: Opaque id chosen by the client (no accounts in Phase 1).
    client_id: Mapped[str | None] = mapped_column(String(64))
    answer_text: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20))
    message: Mapped[str] = mapped_column(Text)
    verifier: Mapped[str] = mapped_column(String(80))
    duration_ms: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
