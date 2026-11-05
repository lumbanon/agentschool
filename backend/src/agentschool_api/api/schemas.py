"""Public API payloads. Nothing here may carry an exercise's answer."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

LocalizedText = dict[str, str]


class BoardStep(BaseModel):
    text: LocalizedText
    math: list[str] = []


class Health(BaseModel):
    status: str
    database: str
    verifier: str
    counts: dict[str, int]


class SubjectOut(BaseModel):
    id: str
    spm_code: str
    name: LocalizedText


class LearningStandardOut(BaseModel):
    id: str
    code: str
    description: LocalizedText


class ContentStandardOut(BaseModel):
    id: str
    code: str
    title: LocalizedText
    learning_standards: list[LearningStandardOut]


class ChapterOut(BaseModel):
    id: str
    form: int
    number: int
    title: LocalizedText
    content_standards: list[ContentStandardOut] = []


class CurriculumOut(BaseModel):
    subject: SubjectOut
    framework: dict[str, Any]
    chapters: list[ChapterOut]


class SourceOut(BaseModel):
    kind: str
    author: str | None = None
    citation: str | None = None
    generated_with: str | None = None


class ReviewOut(BaseModel):
    status: str
    reviewed_by: str | None
    reviewed_at: datetime | None


class ChoiceOption(BaseModel):
    id: str
    text: LocalizedText


class ExerciseOut(BaseModel):
    id: str
    revision: int
    prompt: LocalizedText
    answer_format_hint: LocalizedText | None = None
    marks: int
    difficulty: str
    answer_type: str
    #: Only for multiple choice: the options to pick from (never which is correct).
    options: list[ChoiceOption] | None = None
    hints: list[LocalizedText] = []
    review: ReviewOut


class LessonSummary(BaseModel):
    id: str
    revision: int
    subject: str
    form: int
    chapter_id: str
    title: LocalizedText
    summary: LocalizedText | None = None
    estimated_minutes: int | None = None


class LessonOut(LessonSummary):
    chapter: ChapterOut
    learning_standards: list[LearningStandardOut]
    objectives: list[LocalizedText]
    board: list[BoardStep]
    exercises: list[ExerciseOut]
    #: Exercises listed by the lesson but not yet approved (so not shown).
    exercises_withheld: int
    source: SourceOut
    review: ReviewOut


class AttemptIn(BaseModel):
    answer: str = Field(min_length=1, max_length=300)
    client_id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class AttemptOut(BaseModel):
    attempt_id: int
    exercise_id: str
    status: str = Field(description="correct | incorrect | invalid_input | not_verifiable")
    correct: bool | None
    message: str
    interpreted: str | None = Field(default=None, description="How the answer was read, as LaTeX")
    mistake_feedback: LocalizedText | None = None
    #: Revealed only after a correct answer.
    worked_solution: list[BoardStep] | None = None
    verifier: str
    checked_by: str = "SymPy (deterministic mathematics check; no AI)"


class SearchHit(BaseModel):
    document_id: str
    title: str
    heading: str | None
    snippet: str
    rank: float
