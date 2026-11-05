"""Contract validator negatives, sandbox timeout, document chunking, migrations in sync with models."""
import json
import shutil
import time
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

from agentschool_api.importer.contracts import contract_validator
from agentschool_api.importer.documents import DocumentError, chunk_text, extract_text
from agentschool_api.models import Base
from agentschool_api.verification.sandbox import VerifierPool, _sleep
from conftest import CONTRACTS, PILOT_BUNDLE, SAMPLE_BUNDLE

V = contract_validator(CONTRACTS)


@pytest.mark.parametrize("bundle", [SAMPLE_BUNDLE, PILOT_BUNDLE], ids=["sample", "pilot"])
def test_shipped_bundles_are_valid(bundle):
    report, _ = V.validate_bundle(bundle)
    assert report.ok and not report.issues, [str(i) for i in report.issues]


def _ls(d):
    return d["forms"][0]["chapters"][0]["content_standards"][0]["learning_standards"][0]


MUTATIONS = {
    "chapter id convention": ("curriculum/addmath.json", lambda d: d["forms"][0]["chapters"][0].__setitem__("id", "addmath-chapter-2"), "chapter id should be"),
    "standard in wrong parent": ("curriculum/addmath.json", lambda d: _ls(d).update(code="3.1.1", id="addmath-f4-c02-ls-3-1-1"), "does not belong to content standard"),
    "quoted without licence": ("exercises/addmath-f4-c02.json", lambda d: d["exercises"][0].__setitem__("source", {"kind": "quoted", "citation": "A textbook"}), "license"),
    "approved without reviewer": ("exercises/addmath-f4-c02.json", lambda d: d["exercises"][0].__setitem__("review", {"status": "approved"}), "reviewed_by"),
    "bare log": ("exercises/addmath-f4-c02.json", lambda d: d["exercises"][3]["answer"].__setitem__("expected", "log(x)"), "bare log"),
    "solution missing variable": ("exercises/addmath-f4-c02.json", lambda d: d["exercises"][0]["answer"]["solutions"].append({"y": "1"}), "exactly ['x']"),
    "mixed answer types": ("exercises/addmath-f4-c02.json", lambda d: d["exercises"][0]["answer"].__setitem__("expected", "3"), "invalid solution_set answer"),
    "contract major 2": ("lessons/addmath-f4-c02.json", lambda d: d.__setitem__("contract_version", "2.0.0"), "does not match"),
    "newer minor": ("lessons/addmath-f4-c02.json", lambda d: d.__setitem__("contract_version", "1.3.0"), "newer than this validator"),
    "cross-subject exercise": ("lessons/addmath-f4-c02.json", lambda d: d["lessons"][0]["exercises"].append("science-f4-c01-e001"), "is science form 4"),
    "unknown field": ("lessons/addmath-f4-c02.json", lambda d: d["lessons"][0].__setitem__("tittle", {"en": "x"}), "'tittle' was unexpected"),
    "duplicate id": ("exercises/science.json", lambda d: d["exercises"][0].__setitem__("id", "addmath-f4-c02-e001"), "already used"),
    "full text without licence": ("documents/documents.json", lambda d: d["documents"][0].__setitem__("source", {"kind": "adapted", "citation": "x", "license": "unknown"}), "full_text"),
    "path traversal": ("documents/documents.json", lambda d: d["documents"][0].__setitem__("path", "../secret.md"), "does not match"),
    "two rounding rules": ("exercises/science.json", lambda d: d["exercises"][0]["answer"].update(decimal_places=2, significant_figures=3), "not both"),
}


@pytest.mark.parametrize("name", MUTATIONS)
def test_validator_catches(name, tmp_path):
    rel, fn, expect = MUTATIONS[name]
    b = tmp_path / "b"
    shutil.copytree(SAMPLE_BUNDLE, b)
    data = json.loads((b / rel).read_text(encoding="utf-8"))
    fn(data)
    (b / rel).write_bytes((json.dumps(data, indent=2) + "\n").encode())
    V.update_hashes(b)
    report, _ = V.validate_bundle(b)
    errors = [str(i) for i in report.issues if i.level == "error"]
    assert errors and any(expect in e for e in errors), errors


def test_validator_catches_tampering_after_hashing(tmp_path):
    b = tmp_path / "b"
    shutil.copytree(SAMPLE_BUNDLE, b)
    p = b / "documents" / "files" / "addmath-f4-c02-notes.md"
    p.write_bytes(p.read_bytes() + b"tampered")
    report, _ = V.validate_bundle(b)
    assert not report.ok and any("sha256" in i.where for i in report.issues)


# ------------------------------------------------------------------ sandbox

def test_sandbox_runs_checks_in_a_worker_and_enforces_the_timeout():
    pool = VerifierPool(workers=1, timeout=60)
    try:
        spec = {"type": "solution_set", "variables": ["x"], "solutions": [{"x": "-4"}, {"x": "3"}]}
        assert pool.verify(spec, "x = 3 or x = -4").status == "correct"
        pool.timeout = 0.5
        started = time.monotonic()
        finished, _ = pool.call(_sleep, 30)  # a task that would run for 30 s
        assert not finished and time.monotonic() - started < 10  # abandoned, not waited for
        pool.timeout = 60
        assert pool.verify(spec, "x = 3").status == "incorrect"  # a fresh worker took over
    finally:
        pool.close()


# ------------------------------------------------------------------ documents

def test_chunking_follows_headings_and_size_limit():
    text = "# A\n\npara one\n\npara two\n\n## B\n\n" + ("word " * 400).strip()
    chunks = chunk_text(text, max_chars=500)
    assert chunks[0].heading == "A" and "para one" in chunks[0].text and "para two" in chunks[0].text
    assert all(c.heading == "B" for c in chunks[1:]) and all(len(c.text) <= 500 for c in chunks)
    assert [c.ordinal for c in chunks] == list(range(len(chunks)))


def test_extracts_text_and_rejects_unreadable_payloads():
    assert extract_text("﻿Hello\r\nworld".encode(), "text/plain") == "Hello\nworld"
    with pytest.raises(DocumentError, match="UTF-8"):
        extract_text(b"\xff\xfe\x00bad", "text/markdown")
    from io import BytesIO

    from pypdf import PdfWriter

    buf = BytesIO()
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    w.write(buf)
    with pytest.raises(DocumentError, match="no extractable text"):
        extract_text(buf.getvalue(), "application/pdf")


# ------------------------------------------------------------------ migrations

def test_migrations_match_the_models(engine):
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata)
    assert diff == [], f"models and migrations differ; generate a new revision: {diff}"


def test_backend_never_copies_the_contract_schemas():
    """Single source of truth: the importer reads schemas from docs/contracts."""
    backend = Path(__file__).resolve().parents[1]
    assert not list(backend.rglob("*.schema.json")) or all(".venv" in str(p) for p in backend.rglob("*.schema.json"))
