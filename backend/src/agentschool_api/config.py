from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    """Configuration from environment variables (prefix AGENTSCHOOL_) or backend/.env."""

    model_config = SettingsConfigDict(env_prefix="AGENTSCHOOL_", env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str = "postgresql+psycopg://agentschool:agentschool-dev@127.0.0.1:5433/agentschool"
    #: Where the versioned import contracts live (single source of truth for schemas + validator).
    contracts_dir: Path = REPO_DIR / "docs" / "contracts" / "curriculum-import" / "v1"
    #: Browser origins allowed to call the API (the Vite dev server and preview).
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173", "http://127.0.0.1:4173"]
    verifier_workers: int = 2
    verifier_timeout_seconds: float = 5.0
    #: Largest document payload accepted by the importer (SPEC.md §9).
    max_document_bytes: int = 20 * 1024 * 1024
    #: Chunk size for document text (characters).
    chunk_chars: int = 1500


@lru_cache
def get_settings() -> Settings:
    return Settings()
