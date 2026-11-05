"""Test fixtures.

Database tests use a dedicated PostgreSQL database (default: the `agentschool_test`
database of the docker-compose service on port 5433; override with
AGENTSCHOOL_TEST_DATABASE_URL). The schema is created by running the real Alembic
migrations, so migrations are tested too. Tables are truncated before each test.
"""
from __future__ import annotations

import os
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from agentschool_api.config import BACKEND_DIR, REPO_DIR
from agentschool_api.models import Base
from agentschool_api.verification.verify import Verdict, verify

TEST_DB_URL = os.environ.get(
    "AGENTSCHOOL_TEST_DATABASE_URL", "postgresql+psycopg://agentschool:agentschool-dev@127.0.0.1:5433/agentschool_test"
)
CONTRACTS = REPO_DIR / "docs" / "contracts" / "curriculum-import" / "v1"
SAMPLE_BUNDLE = CONTRACTS / "examples" / "sample-bundle"
PILOT_BUNDLE = BACKEND_DIR / "seed" / "pilot-lesson"


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    eng = create_engine(TEST_DB_URL, pool_pre_ping=True)
    try:
        with eng.connect() as c:
            c.execute(text("select 1"))
    except Exception as exc:  # pragma: no cover - environment problem, reported loudly
        pytest.exit(f"Test database not reachable at {TEST_DB_URL}: {exc}\nStart it with: docker compose up -d (in backend/)", returncode=2)
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", TEST_DB_URL)
    command.upgrade(cfg, "head")
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    names = ", ".join(t.name for t in reversed(Base.metadata.sorted_tables))
    with engine.begin() as c:
        c.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    session = Session(engine, expire_on_commit=False)
    try:
        yield session
    finally:
        session.rollback()
        session.close()


class InlineVerifier:
    """Same verify() as production, without the worker process (fast tests)."""

    def verify(self, answer: dict[str, Any], text_: str, mistakes: list[dict[str, Any]] | None = None) -> Verdict:
        return verify(answer, text_, mistakes)

    def warm_up(self) -> None: ...

    def close(self) -> None: ...


@pytest.fixture
def bundle_copy(tmp_path: Path):  # noqa: ANN201
    """Copy a bundle to a temp dir so a test can edit it (then call update_hashes)."""

    def make(src: Path = SAMPLE_BUNDLE) -> Path:
        dst = tmp_path / src.name
        shutil.copytree(src, dst)
        return dst

    return make
