"""Command line for operators: migrations, validation, imports and human review.

    agentschool db upgrade
    agentschool validate <bundle>
    agentschool import <bundle> --operator "Name" [--dry-run] [--trust-approvals]
    agentschool pending
    agentschool review lesson <id> --status approved --reviewer "Name" [--notes "..."] [--with-exercises]
    agentschool serve [--port 8010]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import select

from .config import BACKEND_DIR, get_settings
from .db import get_engine, session_factory, session_scope
from .importer.contracts import contract_validator
from .importer.importer import ReviewError, import_bundle, set_review
from .models import Document, Exercise, Lesson


def _cmd_db(args: argparse.Namespace) -> int:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", get_settings().database_url)
    command.upgrade(cfg, "head")
    print("database is at the latest migration")
    return 0


def _cmd_validate(args: argparse.Namespace) -> int:
    return contract_validator().main([str(args.bundle)] + (["--json"] if args.json else []))


def _cmd_import(args: argparse.Namespace) -> int:
    session = session_factory()()
    try:
        result = import_bundle(session, args.bundle, operator=args.operator, dry_run=args.dry_run, trust_approvals=args.trust_approvals)
        if result.ok and not args.dry_run:
            session.commit()
        else:
            session.rollback()
    finally:
        session.close()
    if args.json:
        print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
    else:
        for e in result.errors:
            print(f"[ERROR] {e}")
        for w in result.warnings:
            print(f"[WARNING] {w}")
        state = "DRY RUN OK (nothing written)" if result.ok and args.dry_run else "IMPORTED" if result.ok else "FAILED (nothing written)"
        print(f"{state}: {json.dumps(result.counts)}" + (f" batch #{result.batch_id}" if result.batch_id and not args.dry_run else ""))
    return 0 if result.ok else 1


def _cmd_pending(args: argparse.Namespace) -> int:
    with session_scope() as s:
        for kind, model in (("lesson", Lesson), ("exercise", Exercise), ("document", Document)):
            for row in s.scalars(select(model).where(model.review_status != "approved").order_by(model.id)):
                print(f"{kind:9} {row.id:40} rev {row.revision}  {row.review_status}")
    return 0


def _cmd_review(args: argparse.Namespace) -> int:
    try:
        with session_scope() as s:
            row = set_review(s, args.kind, args.id, args.status, args.reviewer, args.notes)
            done = [f"{args.kind} {row.id} -> {args.status}"]
            if args.with_exercises:
                if args.kind != "lesson":
                    raise ReviewError("--with-exercises only applies to lessons")
                for link in row.exercise_links:
                    set_review(s, "exercise", link.exercise_id, args.status, args.reviewer, args.notes)
                    done.append(f"exercise {link.exercise_id} -> {args.status}")
    except ReviewError as exc:
        print(f"[ERROR] {exc}")
        return 1
    print("\n".join(done))
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    uvicorn.run("agentschool_api.api.main:app", host=args.host, port=args.port, reload=False)
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="agentschool", description="AgentSchool backend operations")
    sub = p.add_subparsers(dest="cmd", required=True)

    db = sub.add_parser("db", help="database migrations")
    db.add_argument("action", choices=["upgrade"])
    db.set_defaults(fn=_cmd_db)

    v = sub.add_parser("validate", help="validate a bundle against the import contract (no database)")
    v.add_argument("bundle", type=Path)
    v.add_argument("--json", action="store_true")
    v.set_defaults(fn=_cmd_validate)

    i = sub.add_parser("import", help="import a bundle (one transaction)")
    i.add_argument("bundle", type=Path)
    i.add_argument("--operator", required=True, help="who is running the import (recorded)")
    i.add_argument("--dry-run", action="store_true", help="check everything, write nothing")
    i.add_argument("--trust-approvals", action="store_true", help="keep 'approved' review states from the files")
    i.add_argument("--json", action="store_true")
    i.set_defaults(fn=_cmd_import)

    pe = sub.add_parser("pending", help="list content that is not approved yet")
    pe.set_defaults(fn=_cmd_pending)

    r = sub.add_parser("review", help="record a human review decision")
    r.add_argument("kind", choices=["lesson", "exercise", "document"])
    r.add_argument("id")
    r.add_argument("--status", required=True, choices=["draft", "pending_review", "approved", "rejected"])
    r.add_argument("--reviewer", required=True)
    r.add_argument("--notes")
    r.add_argument("--with-exercises", action="store_true", help="apply the same decision to the lesson's exercises")
    r.set_defaults(fn=_cmd_review)

    sv = sub.add_parser("serve", help="run the API")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--port", type=int, default=8010)
    sv.set_defaults(fn=_cmd_serve)

    args = p.parse_args(argv)
    get_engine()  # fail early with a clear message if the URL is malformed
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
