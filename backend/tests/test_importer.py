"""Bundle import: validation gate, transactions, revisions, review policy, documents."""
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from agentschool_api.importer.contracts import contract_validator
from agentschool_api.importer.importer import ReviewError, import_bundle, set_review
from agentschool_api.models import ContentRevision, Document, DocumentChunk, Exercise, ImportBatch, LearningStandard, Lesson, ReviewEvent
from conftest import CONTRACTS, PILOT_BUNDLE, SAMPLE_BUNDLE

OP = "test operator"


def edit(bundle: Path, rel: str, fn) -> None:
    p = bundle / rel
    data = json.loads(p.read_text(encoding="utf-8"))
    fn(data)
    p.write_bytes((json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode())
    contract_validator(CONTRACTS).update_hashes(bundle)


def count(db, model) -> int:
    return db.scalar(select(func.count()).select_from(model))


def test_imports_the_sample_bundle(db):
    r = import_bundle(db, SAMPLE_BUNDLE, OP, contracts_dir=CONTRACTS)
    assert r.ok, r.errors
    db.commit()
    assert r.counts["exercise"]["created"] == 8 and r.counts["lesson"]["created"] == 1 and r.counts["document"]["created"] == 1
    assert count(db, LearningStandard) == 3
    lesson = db.get(Lesson, "addmath-f4-c02-l01")
    assert [link.exercise_id for link in lesson.exercise_links][:2] == ["addmath-f4-c02-e001", "addmath-f4-c02-e002"]
    batch = db.get(ImportBatch, r.batch_id)
    assert (batch.dataset_id, batch.operator, batch.contract_version) == ("sample-bundle", OP, "1.0.0")


def test_reimport_is_idempotent(db):
    assert import_bundle(db, SAMPLE_BUNDLE, OP, contracts_dir=CONTRACTS).ok
    db.commit()
    again = import_bundle(db, SAMPLE_BUNDLE, OP, contracts_dir=CONTRACTS)
    assert again.ok
    assert again.counts["exercise"] == {"created": 0, "updated": 0, "unchanged": 8}
    assert again.counts["learning_standard"]["unchanged"] == 3


def test_dry_run_writes_nothing(db):
    r = import_bundle(db, SAMPLE_BUNDLE, OP, dry_run=True, contracts_dir=CONTRACTS)
    assert r.ok and r.dry_run
    db.rollback()  # what the CLI does for a dry run
    assert count(db, Exercise) == 0


def test_invalid_bundle_writes_nothing(db, bundle_copy):
    b = bundle_copy()
    edit(b, "lessons/addmath-f4-c02.json", lambda d: d["lessons"][0].__setitem__("tittle", {"en": "typo"}))
    r = import_bundle(db, b, OP, contracts_dir=CONTRACTS)
    assert not r.ok and any("tittle" in e for e in r.errors)
    assert count(db, Exercise) == 0 and count(db, ImportBatch) == 0


def test_answer_self_check_failure_blocks_the_import(db, bundle_copy):
    b = bundle_copy()
    edit(b, "exercises/addmath-f4-c02.json", lambda d: d["exercises"][0].__setitem__(
        "common_mistakes", [{"answer": "x = 3 or x = -4", "feedback": {"en": "this is actually right"}}]))
    r = import_bundle(db, b, OP, contracts_dir=CONTRACTS)
    assert not r.ok and any("verifies as CORRECT" in e for e in r.errors)
    assert count(db, Exercise) == 0


def test_new_revision_updates_and_keeps_history(db, bundle_copy):
    assert import_bundle(db, SAMPLE_BUNDLE, OP, contracts_dir=CONTRACTS).ok
    db.commit()
    b = bundle_copy()
    edit(b, "exercises/addmath-f4-c02.json", lambda d: d["exercises"][0].update(revision=2, marks=3))
    r = import_bundle(db, b, OP, contracts_dir=CONTRACTS)
    assert r.ok, r.errors
    db.commit()
    assert r.counts["exercise"] == {"created": 0, "updated": 1, "unchanged": 7}
    ex = db.get(Exercise, "addmath-f4-c02-e001")
    assert (ex.revision, ex.data["marks"]) == (2, 3)
    old = db.scalars(select(ContentRevision).where(ContentRevision.item_id == ex.id)).one()
    assert (old.revision, old.data["marks"]) == (1, 2)


def test_same_revision_with_different_content_is_rejected(db, bundle_copy):
    assert import_bundle(db, SAMPLE_BUNDLE, OP, contracts_dir=CONTRACTS).ok
    db.commit()
    b = bundle_copy()
    edit(b, "exercises/addmath-f4-c02.json", lambda d: d["exercises"][0].update(marks=9))
    r = import_bundle(db, b, OP, contracts_dir=CONTRACTS)
    assert not r.ok and any("bump `revision`" in e for e in r.errors)


def test_older_revision_is_rejected(db, bundle_copy):
    b2 = bundle_copy()
    edit(b2, "exercises/addmath-f4-c02.json", lambda d: d["exercises"][0].update(revision=3))
    assert import_bundle(db, b2, OP, contracts_dir=CONTRACTS).ok
    db.commit()
    r = import_bundle(db, SAMPLE_BUNDLE, OP, contracts_dir=CONTRACTS)
    assert not r.ok and any("older than the stored revision 3" in e for e in r.errors)


def test_review_only_changes_do_not_count_as_content_changes(db, bundle_copy):
    assert import_bundle(db, SAMPLE_BUNDLE, OP, contracts_dir=CONTRACTS).ok
    db.commit()
    b = bundle_copy()
    edit(b, "exercises/addmath-f4-c02.json", lambda d: d["exercises"][0].__setitem__("review", {"status": "draft"}))
    r = import_bundle(db, b, OP, contracts_dir=CONTRACTS)
    assert r.ok and r.counts["exercise"]["unchanged"] == 8


APPROVED = {"status": "approved", "reviewed_by": "Cikgu Example", "reviewed_at": "2026-11-05T09:00:00Z", "notes": "checked"}


def test_approvals_in_files_are_not_trusted_by_default(db, bundle_copy):
    b = bundle_copy()
    edit(b, "lessons/addmath-f4-c02.json", lambda d: d["lessons"][0].__setitem__("review", APPROVED))
    r = import_bundle(db, b, OP, contracts_dir=CONTRACTS)
    assert r.ok
    assert db.get(Lesson, "addmath-f4-c02-l01").review_status == "pending_review"
    assert any("not trusted" in w for w in r.warnings)
    assert count(db, ReviewEvent) == 0


def test_trusted_approvals_are_kept_and_logged(db, bundle_copy):
    b = bundle_copy()
    edit(b, "lessons/addmath-f4-c02.json", lambda d: d["lessons"][0].__setitem__("review", APPROVED))
    assert import_bundle(db, b, OP, trust_approvals=True, contracts_dir=CONTRACTS).ok
    lesson = db.get(Lesson, "addmath-f4-c02-l01")
    assert (lesson.review_status, lesson.reviewed_by) == ("approved", "Cikgu Example")
    ev = db.scalars(select(ReviewEvent)).one()
    assert (ev.via, ev.reviewer, ev.to_status) == ("import", "Cikgu Example", "approved")


def test_partial_bundle_must_reference_existing_items(db, bundle_copy):
    b = bundle_copy(PILOT_BUNDLE)
    manifest = json.loads((b / "manifest.json").read_text(encoding="utf-8"))
    manifest["files"] = [f for f in manifest["files"] if f["kind"] != "curriculum"]
    (b / "manifest.json").write_bytes((json.dumps(manifest, indent=2) + "\n").encode())
    r = import_bundle(db, b, OP, contracts_dir=CONTRACTS)
    assert not r.ok and any("learning standard 'addmath-f4-c02-ls-2-1-1' is referenced" in e for e in r.errors)
    # once the curriculum is in the database, the same partial bundle imports
    assert import_bundle(db, PILOT_BUNDLE, OP, contracts_dir=CONTRACTS).ok
    db.commit()
    assert import_bundle(db, b, OP, contracts_dir=CONTRACTS).ok


def test_documents_are_chunked_and_searchable(db):
    assert import_bundle(db, SAMPLE_BUNDLE, OP, contracts_dir=CONTRACTS).ok
    db.commit()
    doc = db.get(Document, "doc-addmath-f4-c02-notes")
    assert doc.text_chars > 100 and [c.heading for c in doc.chunks] == ["Factorisation", "Checking roots", "Common mistakes"]
    hit = db.execute(text("SELECT document_id, heading FROM document_chunks WHERE tsv @@ websearch_to_tsquery('simple', 'substitute root')")).one()
    assert hit.heading == "Checking roots"


def test_metadata_only_documents_store_no_text(db, bundle_copy):
    b = bundle_copy()
    edit(b, "documents/documents.json", lambda d: d["documents"][0].update(usage="metadata_only"))
    assert import_bundle(db, b, OP, contracts_dir=CONTRACTS).ok
    assert count(db, DocumentChunk) == 0 and db.get(Document, "doc-addmath-f4-c02-notes").text_chars == 0


def test_operator_is_required(db):
    assert not import_bundle(db, SAMPLE_BUNDLE, "  ", contracts_dir=CONTRACTS).ok


def test_human_review_is_recorded(db):
    assert import_bundle(db, PILOT_BUNDLE, OP, contracts_dir=CONTRACTS).ok
    with pytest.raises(ReviewError):
        set_review(db, "lesson", "addmath-f4-c02-l01", "approved", " ")
    with pytest.raises(ReviewError):
        set_review(db, "lesson", "no-such-lesson", "approved", "Cikgu Example")
    row = set_review(db, "lesson", "addmath-f4-c02-l01", "approved", "Cikgu Example", "checked the maths")
    assert (row.review_status, row.reviewed_by) == ("approved", "Cikgu Example") and row.reviewed_at is not None
    ev = db.scalars(select(ReviewEvent)).one()
    assert (ev.from_status, ev.to_status, ev.via) == ("pending_review", "approved", "cli")


def test_database_refuses_approval_without_reviewer(db):
    """Defence in depth: the CHECK constraint holds even if application code is bypassed."""
    assert import_bundle(db, PILOT_BUNDLE, OP, contracts_dir=CONTRACTS).ok
    db.commit()
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        db.execute(text("UPDATE lessons SET review_status = 'approved' WHERE id = 'addmath-f4-c02-l01'"))
        db.flush()
