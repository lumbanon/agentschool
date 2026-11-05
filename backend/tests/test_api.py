"""HTTP API: only approved content, answers never leave the server, attempts are verified and stored."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from agentschool_api.api.main import create_app
from agentschool_api.importer.importer import import_bundle, set_review
from agentschool_api.models import Attempt
from conftest import CONTRACTS, SAMPLE_BUNDLE, InlineVerifier

LESSON = "addmath-f4-c02-l01"
SECRET_KEYS = {"answer", "solutions", "expected", "correct", "common_mistakes", "worked_solution", "tolerance"}


@pytest.fixture
def client(db, engine):
    assert import_bundle(db, SAMPLE_BUNDLE, "test operator", contracts_dir=CONTRACTS).ok
    db.commit()
    with TestClient(create_app(engine=engine, verifier=InlineVerifier())) as c:
        yield c


def approve(db, kind, item_id):
    set_review(db, kind, item_id, "approved", "Cikgu Example", "test approval")
    db.commit()


def keys_anywhere(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from keys_anywhere(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from keys_anywhere(v)


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["database"] == "ok" and body["counts"]["approved_lessons"] == 0 and body["verifier"].startswith("agentschool-verifier")


def test_curriculum_tree(client):
    r = client.get("/api/v1/subjects/addmath/curriculum", params={"form": 4})
    assert r.status_code == 200
    ch = r.json()["chapters"][0]
    assert ch["id"] == "addmath-f4-c02" and ch["content_standards"][0]["learning_standards"][0]["code"] == "2.1.1"
    assert client.get("/api/v1/subjects/nope/curriculum").status_code == 404
    assert {s["id"] for s in client.get("/api/v1/subjects").json()} == {"addmath", "science"}


def test_unapproved_lessons_are_invisible(client):
    assert client.get("/api/v1/lessons").json() == []
    assert client.get(f"/api/v1/lessons/{LESSON}").status_code == 404


def test_approved_lesson_without_any_answers(client, db):
    approve(db, "lesson", LESSON)
    approve(db, "exercise", "addmath-f4-c02-e001")
    approve(db, "exercise", "addmath-f4-c02-e004")
    r = client.get(f"/api/v1/lessons/{LESSON}")
    assert r.status_code == 200
    body = r.json()
    assert body["title"]["en"] == "Solving quadratic equations by factorisation"
    assert [e["id"] for e in body["exercises"]] == ["addmath-f4-c02-e001", "addmath-f4-c02-e004"]
    assert body["exercises_withheld"] == 3  # still pending review
    assert body["review"]["reviewed_by"] == "Cikgu Example"
    assert body["source"]["generated_with"] == "claude-code"  # AI drafting is disclosed
    leaked = SECRET_KEYS & set(keys_anywhere(body))
    assert not leaked, f"answer data leaked: {leaked}"
    assert [s["id"] for s in client.get("/api/v1/lessons", params={"subject": "addmath"}).json()] == [LESSON]


def test_multiple_choice_options_are_sent_but_not_the_answer(client, db):
    approve(db, "exercise", "science-f4-c01-e002")
    set_review(db, "lesson", LESSON, "approved", "x x")  # any approved lesson; check the exercise payload mapper directly
    db.commit()
    from agentschool_api.api.main import _exercise_out
    from agentschool_api.models import Exercise

    out = _exercise_out(db.get(Exercise, "science-f4-c01-e002")).model_dump()
    assert [o["id"] for o in out["options"]] == ["A", "B", "C", "D"]
    assert not SECRET_KEYS & set(keys_anywhere(out))


def test_attempts_are_verified_and_stored(client, db):
    approve(db, "exercise", "addmath-f4-c02-e001")
    url = "/api/v1/exercises/addmath-f4-c02-e001/attempts"
    ok = client.post(url, json={"answer": "x = 3 or x = -4", "client_id": "student-1"}).json()
    assert (ok["status"], ok["correct"]) == ("correct", True)
    assert ok["worked_solution"] and "SymPy" in ok["checked_by"]
    wrong = client.post(url, json={"answer": "x = 4 or x = -3"}).json()
    assert (wrong["status"], wrong["correct"], wrong["worked_solution"]) == ("incorrect", False, None)
    assert wrong["mistake_feedback"]["en"].startswith("Check the signs")
    bad = client.post(url, json={"answer": "x equals four"}).json()
    assert (bad["status"], bad["correct"]) == ("invalid_input", None)
    rows = db.scalars(select(Attempt).order_by(Attempt.id)).all()
    assert [r.status for r in rows] == ["correct", "incorrect", "invalid_input"]
    assert rows[0].client_id == "student-1" and rows[0].exercise_revision == 1


def test_attempts_on_unapproved_exercises_are_refused(client):
    r = client.post("/api/v1/exercises/addmath-f4-c02-e002/attempts", json={"answer": "x = 3"})
    assert r.status_code == 404


@pytest.mark.parametrize("body", [{"answer": ""}, {"answer": "x" * 301}, {"answer": "1", "client_id": "bad id!"}, {}])
def test_attempt_input_is_validated(client, db, body):
    approve(db, "exercise", "addmath-f4-c02-e001")
    assert client.post("/api/v1/exercises/addmath-f4-c02-e001/attempts", json=body).status_code == 422


def test_document_search_only_returns_approved_documents(client, db):
    assert client.get("/api/v1/documents/search", params={"q": "zero-product"}).json() == []
    approve(db, "document", "doc-addmath-f4-c02-notes")
    hits = client.get("/api/v1/documents/search", params={"q": "zero-product", "subject": "addmath"}).json()
    assert hits and hits[0]["document_id"] == "doc-addmath-f4-c02-notes" and hits[0]["heading"] == "Factorisation"
    assert client.get("/api/v1/documents/search", params={"q": "zero-product", "subject": "science"}).json() == []


def test_cors_allows_the_classroom_dev_server(client):
    r = client.options(
        "/api/v1/health", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"}
    )
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
    r = client.options("/api/v1/health", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers
