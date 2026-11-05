"""Load the contract's own validator from docs/contracts (single source of truth).

The validator ships with the contract so dataset authors can run it without the
backend. The importer imports that exact file instead of keeping a copy.
"""
from __future__ import annotations

import importlib.util
import sys
from functools import lru_cache
from pathlib import Path
from types import ModuleType

from ..config import get_settings


@lru_cache
def contract_validator(contracts_dir: Path | None = None) -> ModuleType:
    directory = contracts_dir or get_settings().contracts_dir
    path = Path(directory) / "validate.py"
    if not path.is_file():
        raise RuntimeError(f"contract validator not found at {path} (set AGENTSCHOOL_CONTRACTS_DIR)")
    spec = importlib.util.spec_from_file_location("agentschool_contract_v1_validate", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module
