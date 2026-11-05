"""Import a curriculum-import v1 bundle into the database (SPEC.md §10).

    result = import_bundle(session, Path("bundle"), operator="name", dry_run=True)

Stages, in order; any error stops the import and nothing is written:
  1. the contract validator (schemas, hashes, ids, in-bundle references)
  2. SymPy self-checks of every answer and common mistake
  3. references to items outside the bundle must exist in the database
  4. revision rules against what is already stored
Then everything is written in the caller's single transaction (the caller
commits; a dry run rolls back).
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import (
    Chapter,
    ContentRevision,
    ContentStandard,
    Document,
    DocumentChunk,
    Exercise,
    ImportBatch,
    ItemLearningStandard,
    LearningStandard,
    Lesson,
    LessonExercise,
    ReviewEvent,
    Subject,
)
from ..verification.verify import CORRECT, INVALID, NOT_VERIFIABLE, SpecError, canonical_answer_text, verify
from .contracts import contract_validator
from .documents import DocumentError, chunk_text, extract_text

KIND_MODEL = {"exercise": Exercise, "lesson": Lesson, "document": Document}


@dataclass
class ImportResult:
    ok: bool = True
    dry_run: bool = False
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    #: per kind: created / updated / unchanged
    counts: dict[str, dict[str, int]] = field(default_factory=dict)
    batch_id: int | None = None

    def error(self, msg: str) -> None:
        self.ok = False
        self.errors.append(msg)

    def bump(self, kind: str, what: str) -> None:
        self.counts.setdefault(kind, {"created": 0, "updated": 0, "unchanged": 0})[what] += 1

    def to_dict(self) -> dict[str, Any]:
        return {"ok": self.ok, "dry_run": self.dry_run, "errors": self.errors, "warnings": self.warnings, "counts": self.counts, "batch_id": self.batch_id}


def content_hash(item: dict[str, Any]) -> str:
    """Hash of the content only: the review block is metadata about the content, not content."""
    body = {k: v for k, v in item.items() if k != "review"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


# ------------------------------------------------------------------ stage 2: answer self-checks

def self_check_exercise(ex: dict[str, Any]) -> list[str]:
    """The expected answer must verify as correct, and each common mistake must parse and be wrong."""
    problems: list[str] = []
    answer, mistakes = ex["answer"], ex.get("common_mistakes", [])
    try:
        v = verify(answer, canonical_answer_text(answer), mistakes)
    except SpecError as exc:
        return [f"exercise {ex['id']}: answer spec unusable: {exc}"]
    except Exception as exc:  # parsing of the expected value itself (e.g. rounding helpers)
        return [f"exercise {ex['id']}: expected answer could not be processed: {exc}"]
    if answer["type"] == "manual":
        if v.status not in (NOT_VERIFIABLE,):
            problems.append(f"exercise {ex['id']}: manual answer self-check returned {v.status}")
    elif v.status != CORRECT:
        problems.append(f"exercise {ex['id']}: the expected answer does not verify as correct ({v.status}: {v.message})")
    for m in mistakes:
        mv = verify(answer, m["answer"], [])
        if mv.status == CORRECT:
            problems.append(f"exercise {ex['id']}: common mistake {m['answer']!r} verifies as CORRECT")
        elif mv.status == INVALID:
            problems.append(f"exercise {ex['id']}: common mistake {m['answer']!r} cannot be read by the verifier ({mv.message})")
    return problems


# ------------------------------------------------------------------ review policy

def _review_for_import(item: dict[str, Any], trust: bool, result: ImportResult) -> dict[str, Any]:
    r = dict(item["review"])
    if r["status"] == "approved" and not trust:
        result.warnings.append(f"{item['id']}: 'approved' in the file was not trusted; imported as pending_review (use --trust-approvals to keep it)")
        return {"status": "pending_review", "reviewed_by": None, "reviewed_at": None, "notes": r.get("notes")}
    return {"status": r["status"], "reviewed_by": r.get("reviewed_by"), "reviewed_at": r.get("reviewed_at"), "notes": r.get("notes")}


def _apply_review(row: Any, review: dict[str, Any]) -> None:
    row.review_status = review["status"]
    row.reviewed_by = review["reviewed_by"]
    row.reviewed_at = datetime.fromisoformat(review["reviewed_at"].replace("Z", "+00:00")) if isinstance(review["reviewed_at"], str) else review["reviewed_at"]
    row.review_notes = review["notes"]


# ------------------------------------------------------------------ main entry

def import_bundle(
    session: Session,
    root: Path,
    operator: str,
    dry_run: bool = False,
    trust_approvals: bool = False,
    contracts_dir: Path | None = None,
) -> ImportResult:
    result = ImportResult(dry_run=dry_run)
    if not operator or not operator.strip():
        result.error("an operator name is required (who is importing?)")
        return result
    validator = contract_validator(contracts_dir)
    report, parsed = validator.validate_bundle(Path(root))
    for issue in report.issues:
        (result.errors if issue.level == "error" else result.warnings).append(str(issue))
    if not report.ok:
        result.ok = False
        return result

    curriculum = [d for _, d in parsed["curriculum"]]
    exercises = [ex for _, d in parsed["exercises"] for ex in d["exercises"]]
    lessons = [ls for _, d in parsed["lessons"] for ls in d["lessons"]]
    documents = [doc for _, d in parsed["documents"] for doc in d["documents"]]

    # ---- stage 2: answers
    for ex in exercises:
        for problem in self_check_exercise(ex):
            result.error(problem)

    # ---- stage 3: references outside the bundle
    bundle_ls = {ls["id"] for c in curriculum for f in c["forms"] for ch in f["chapters"] for cs in ch["content_standards"] for ls in cs["learning_standards"]}
    bundle_chapters = {ch["id"] for c in curriculum for f in c["forms"] for ch in f["chapters"]}
    bundle_subjects = {c["subject"]["id"] for c in curriculum}
    bundle_exercises = {e["id"] for e in exercises}

    def missing(model: Any, ids: set[str]) -> set[str]:
        if not ids:
            return set()
        found = set(session.scalars(select(model.id).where(model.id.in_(ids))))
        return ids - found

    wanted_ls = {s for item in [*exercises, *lessons, *documents] for s in item.get("learning_standards", [])} - bundle_ls
    wanted_ch = {ls["chapter"] for ls in lessons} - bundle_chapters
    wanted_ex = {e for ls in lessons for e in ls["exercises"]} - bundle_exercises
    wanted_subjects = {item["subject"] for item in [*exercises, *lessons, *documents]} - bundle_subjects
    for kind, model, ids in (
        ("learning standard", LearningStandard, wanted_ls),
        ("chapter", Chapter, wanted_ch),
        ("exercise", Exercise, wanted_ex),
        ("subject", Subject, wanted_subjects),
    ):
        for m in sorted(missing(model, ids)):
            result.error(f"{kind} '{m}' is referenced but exists neither in the bundle nor in the database")

    # ---- stage 4: revisions
    def check_revision(kind: str, item: dict[str, Any]) -> str:
        """Returns 'create' | 'update' | 'unchanged' (or records an error and returns 'skip')."""
        model = KIND_MODEL[kind]
        row = session.get(model, item["id"])
        h = item["_hash"]
        if row is None:
            return "create"
        if item["revision"] == row.revision:
            if h == row.content_hash:
                return "unchanged"
            result.error(f"{kind} {item['id']} revision {item['revision']}: content differs from the stored revision {row.revision}; bump `revision`")
            return "skip"
        if item["revision"] < row.revision:
            result.error(f"{kind} {item['id']}: revision {item['revision']} is older than the stored revision {row.revision}")
            return "skip"
        return "update"

    settings = get_settings()
    payloads: dict[str, bytes] = {}
    for doc in documents:
        path = Path(root) / doc["path"]
        size = path.stat().st_size
        if size > settings.max_document_bytes:
            result.error(f"document {doc['id']}: payload is {size} bytes (max {settings.max_document_bytes})")
            continue
        payloads[doc["id"]] = path.read_bytes()
        doc["_hash"] = doc["sha256"]
    for item in [*exercises, *lessons]:
        item["_hash"] = content_hash(item)

    plans: dict[str, dict[str, str]] = {"exercise": {}, "lesson": {}, "document": {}}
    for kind, items in (("exercise", exercises), ("lesson", lessons), ("document", documents)):
        for item in items:
            if "_hash" in item:
                plans[kind][item["id"]] = check_revision(kind, item)

    # extract document text up front so a bad PDF fails the import before any write
    texts: dict[str, str] = {}
    for doc in documents:
        if doc["id"] in payloads and doc["usage"] == "full_text" and plans["document"].get(doc["id"]) in ("create", "update"):
            try:
                texts[doc["id"]] = extract_text(payloads[doc["id"]], doc["media_type"])
            except DocumentError as exc:
                result.error(f"document {doc['id']}: {exc}")

    if not result.ok:
        return result

    # ---- write
    manifest = parsed["manifest"]
    batch = ImportBatch(
        dataset_id=manifest["dataset"]["id"],
        dataset_version=manifest["dataset"]["version"],
        contract_version=manifest["contract_version"],
        manifest_sha256=validator.sha256_of(Path(root) / "manifest.json"),
        operator=operator.strip(),
        trust_approvals=trust_approvals,
    )
    session.add(batch)
    session.flush()

    for c in curriculum:
        _upsert_curriculum(session, c, result)

    for ex in exercises:
        _upsert_content(session, "exercise", ex, plans["exercise"][ex["id"]], batch, trust_approvals, result, _exercise_fields)
    session.flush()
    for ls in lessons:
        row = _upsert_content(session, "lesson", ls, plans["lesson"][ls["id"]], batch, trust_approvals, result, _lesson_fields)
        if row is not None:
            row.exercise_links = [LessonExercise(exercise_id=e, position=i) for i, e in enumerate(ls["exercises"])]
    for doc in documents:
        row = _upsert_content(session, "document", doc, plans["document"][doc["id"]], batch, trust_approvals, result, _document_fields)
        if row is not None:
            text = texts.get(doc["id"])
            row.chunks = [
                DocumentChunk(ordinal=c.ordinal, heading=c.heading, text=c.text)
                for c in (chunk_text(text, settings.chunk_chars, markdown=doc["media_type"] == "text/markdown") if text else [])
            ]
            row.text_chars = len(text or "")

    batch.summary = result.counts
    batch.warnings = result.warnings
    session.flush()
    result.batch_id = batch.id
    return result


def _upsert_curriculum(session: Session, doc: dict[str, Any], result: ImportResult) -> None:
    s = doc["subject"]
    subject = session.get(Subject, s["id"]) or Subject(id=s["id"])
    subject.spm_code, subject.name, subject.framework = s["spm_code"], s["name"], doc["framework"]
    session.merge(subject)

    def upsert(kind: str, obj: Any, fields: tuple[str, ...]) -> None:
        existing = session.get(type(obj), obj.id)
        if existing is None:
            result.bump(kind, "created")
        elif any(getattr(existing, f) != getattr(obj, f) for f in fields):
            result.bump(kind, "updated")
        else:
            result.bump(kind, "unchanged")
        session.merge(obj)

    for form in doc["forms"]:
        for ch in form["chapters"]:
            upsert("chapter", Chapter(id=ch["id"], subject_id=s["id"], form=form["form"], number=ch["number"], title=ch["title"]), ("subject_id", "form", "number", "title"))
            for cs in ch["content_standards"]:
                upsert("content_standard", ContentStandard(id=cs["id"], chapter_id=ch["id"], code=cs["code"], title=cs["title"]), ("chapter_id", "code", "title"))
                for ls in cs["learning_standards"]:
                    upsert(
                        "learning_standard",
                        LearningStandard(id=ls["id"], content_standard_id=cs["id"], chapter_id=ch["id"], code=ls["code"], description=ls["description"]),
                        ("content_standard_id", "chapter_id", "code", "description"),
                    )
    session.flush()


def _clean(item: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in item.items() if not k.startswith("_")}


def _exercise_fields(item: dict[str, Any]) -> dict[str, Any]:
    return {"subject_id": item["subject"], "form": item["form"], "answer_type": item["answer"]["type"], "data": _clean(item)}


def _lesson_fields(item: dict[str, Any]) -> dict[str, Any]:
    return {"subject_id": item["subject"], "form": item["form"], "chapter_id": item["chapter"], "data": _clean(item)}


def _document_fields(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": item["title"],
        "document_type": item["document_type"],
        "language": item["language"],
        "subject_id": item["subject"],
        "form": item.get("form"),
        "media_type": item["media_type"],
        "usage": item["usage"],
        "bundle_path": item["path"],
    }


def _upsert_content(session, kind, item, plan, batch, trust, result, fields_fn):  # type: ignore[no-untyped-def]
    model = KIND_MODEL[kind]
    if plan == "unchanged":
        result.bump(kind, "unchanged")
        return None
    review = _review_for_import(item, trust, result)
    row = session.get(model, item["id"])
    if plan == "update":
        session.add(
            ContentRevision(
                item_kind=kind,
                item_id=row.id,
                revision=row.revision,
                content_hash=row.content_hash,
                data=getattr(row, "data", None) or {"bundle_path": getattr(row, "bundle_path", None)},
                review_status=row.review_status,
            )
        )
        result.bump(kind, "updated")
    else:
        row = model(id=item["id"])
        session.add(row)
        result.bump(kind, "created")
    previous_status = None if plan == "create" else row.review_status
    for k, v in fields_fn(item).items():
        setattr(row, k, v)
    row.revision, row.content_hash, row.source, row.import_batch_id = item["revision"], item["_hash"], item["source"], batch.id
    _apply_review(row, review)
    session.execute(delete(ItemLearningStandard).where(ItemLearningStandard.item_kind == kind, ItemLearningStandard.item_id == item["id"]))
    for sid in item.get("learning_standards", []):
        session.add(ItemLearningStandard(item_kind=kind, item_id=item["id"], learning_standard_id=sid))
    if review["status"] in ("approved", "rejected"):
        session.add(
            ReviewEvent(
                item_kind=kind,
                item_id=item["id"],
                revision=item["revision"],
                from_status=previous_status,
                to_status=review["status"],
                reviewer=review["reviewed_by"],
                notes=f"trusted from dataset by {batch.operator}" + (f": {review['notes']}" if review.get("notes") else ""),
                via="import",
            )
        )
    return row


# ------------------------------------------------------------------ human review (CLI)

class ReviewError(ValueError):
    pass


def set_review(session: Session, kind: str, item_id: str, status: str, reviewer: str, notes: str | None = None) -> Any:
    """Record a human review decision. Approving needs a named reviewer; everything is logged."""
    if kind not in KIND_MODEL:
        raise ReviewError(f"kind must be one of {sorted(KIND_MODEL)}")
    if status not in ("draft", "pending_review", "approved", "rejected"):
        raise ReviewError("status must be draft, pending_review, approved or rejected")
    if not reviewer or len(reviewer.strip()) < 2:
        raise ReviewError("a reviewer name is required")
    row = session.get(KIND_MODEL[kind], item_id)
    if row is None:
        raise ReviewError(f"{kind} '{item_id}' not found")
    previous = row.review_status
    row.review_status = status
    row.reviewed_by = reviewer.strip() if status in ("approved", "rejected") else None
    row.reviewed_at = datetime.now(UTC) if status in ("approved", "rejected") else None
    row.review_notes = notes
    session.add(ReviewEvent(item_kind=kind, item_id=item_id, revision=row.revision, from_status=previous, to_status=status, reviewer=reviewer.strip(), notes=notes, via="cli"))
    session.flush()
    return row
