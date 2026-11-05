"""Run verification in a worker process with a hard timeout.

SymPy simplification can, for unlucky inputs, take a very long time. Input
limits in parsing.py make that rare; this module makes it harmless: each check
runs in a separate process and is abandoned (and the worker replaced) after
`timeout` seconds, so a request can never hang the API.
"""
from __future__ import annotations

import multiprocessing as mp
import threading
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from typing import Any

from .verify import INVALID, Verdict, verify

DEFAULT_TIMEOUT = 5.0


def _run(answer: dict[str, Any], text: str, mistakes: list[dict[str, Any]]) -> dict[str, Any]:
    v = verify(answer, text, mistakes)
    return {"status": v.status, "message": v.message, "interpreted": v.interpreted, "mistake_feedback": v.mistake_feedback, "details": v.details}


def _sleep(seconds: float) -> bool:
    """Deliberately slow task (used to test the timeout path)."""
    import time

    time.sleep(seconds)
    return True


def _warm() -> bool:
    import sympy  # noqa: F401  (import once per worker, ~1 s on first use)

    return True


class VerifierPool:
    def __init__(self, workers: int = 2, timeout: float = DEFAULT_TIMEOUT) -> None:
        self.workers = workers
        self.timeout = timeout
        self._lock = threading.Lock()
        self._pool: ProcessPoolExecutor | None = None

    def _get(self) -> ProcessPoolExecutor:
        with self._lock:
            if self._pool is None:
                self._pool = ProcessPoolExecutor(max_workers=self.workers, mp_context=mp.get_context("spawn"))
            return self._pool

    def warm_up(self) -> None:
        futures = [self._get().submit(_warm) for _ in range(self.workers)]
        for f in futures:
            f.result(timeout=60)

    def _reset(self) -> None:
        with self._lock:
            pool, self._pool = self._pool, None
        if pool is not None:
            for proc in list(getattr(pool, "_processes", {}).values()):
                proc.terminate()  # the stuck worker must not keep burning CPU
            pool.shutdown(wait=False, cancel_futures=True)

    def call(self, fn: Any, *args: Any) -> tuple[bool, Any]:
        """Run fn(*args) in a worker. Returns (finished, result); on timeout the worker is killed and replaced."""
        future = self._get().submit(fn, *args)
        try:
            return True, future.result(timeout=self.timeout)
        except FutureTimeout:
            self._reset()
            return False, None

    def verify(self, answer: dict[str, Any], text: str, mistakes: list[dict[str, Any]] | None = None) -> Verdict:
        finished, r = self.call(_run, answer, text, mistakes or [])
        if not finished:
            return Verdict(INVALID, "That answer took too long to check. Try writing it more simply.", details={"timeout": True})
        return Verdict(r["status"], r["message"], r["interpreted"], r["mistake_feedback"], r["details"])

    def close(self) -> None:
        self._reset()
