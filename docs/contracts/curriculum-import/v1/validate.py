#!/usr/bin/env python3
"""Validate an AgentSchool curriculum-import v1 bundle.

Standalone: needs only Python 3.10+ and `jsonschema` (pip install "jsonschema>=4.18").

    python validate.py path/to/bundle            # human-readable report, exit 1 on errors
    python validate.py path/to/bundle --json     # machine-readable report
    python validate.py path/to/bundle --update-hashes   # rewrite SHA-256s after editing files

Checks (SPEC.md §10): manifest + every file against the JSON Schemas, SHA-256
integrity, contract version, id conventions, uniqueness, and cross-references
inside the bundle. References to things not in the bundle are WARNINGS (the
backend resolves them against its database at import time).

The backend importer runs this same module first, then adds database checks and
SymPy self-checks of every answer.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

CONTRACT = "agentschool.curriculum-import"
SUPPORTED_MAJOR = 1
SUPPORTED_MINOR = 0  # highest 1.x this validator understands
SCHEMA_DIR = Path(__file__).resolve().parent / "schemas"
KIND_SCHEMA = {
    "curriculum": "curriculum.schema.json",
    "lessons": "lessons.schema.json",
    "exercises": "exercises.schema.json",
    "documents": "documents.schema.json",
}
SUFFIX_FOR_MEDIA = {"text/markdown": (".md",), "text/plain": (".txt",), "application/pdf": (".pdf",)}
# Characters allowed in dataset math text (SPEC.md §5). Student input is more permissive.
MATH_TEXT = re.compile(r"^[0-9A-Za-z_+\-*/^().,\s]+$")


@dataclass
class Issue:
    level: str  # "error" | "warning"
    file: str
    where: str
    message: str

    def __str__(self) -> str:
        loc = f"{self.file}{' ' + self.where if self.where else ''}"
        return f"[{self.level.upper()}] {loc}: {self.message}"


@dataclass
class Report:
    issues: list[Issue] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    def error(self, file: str, where: str, message: str) -> None:
        self.issues.append(Issue("error", file, where, message))

    def warning(self, file: str, where: str, message: str) -> None:
        self.issues.append(Issue("warning", file, where, message))

    @property
    def ok(self) -> bool:
        return not any(i.level == "error" for i in self.issues)

    def to_json(self) -> dict[str, Any]:
        return {"ok": self.ok, "counts": self.counts, "issues": [i.__dict__ for i in self.issues]}


def _registry() -> Registry:
    resources = []
    for path in SCHEMA_DIR.glob("*.schema.json"):
        schema = json.loads(path.read_text(encoding="utf-8"))
        resources.append((schema["$id"], Resource.from_contents(schema)))
    return Registry().with_resources(resources)


_REGISTRY: Registry | None = None


def validator_for(schema_file: str) -> Draft202012Validator:
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = _registry()
    schema = json.loads((SCHEMA_DIR / schema_file).read_text(encoding="utf-8"))
    return Draft202012Validator(schema, registry=_REGISTRY, format_checker=FormatChecker())


def _pointer(path: Iterable[Any]) -> str:
    return "/" + "/".join(str(p) for p in path)


def _schema_errors(report: Report, file: str, data: Any, schema_file: str) -> bool:
    errors = sorted(validator_for(schema_file).iter_errors(data), key=lambda e: list(e.absolute_path))
    for e in errors:
        report.error(file, _pointer(e.absolute_path), _readable(e)[:500])
    return not errors


def _readable(e: Any) -> str:
    """oneOf/anyOf/not errors echo the whole object; explain the actual problem instead."""
    if e.validator == "not":
        sub = e.validator_value if isinstance(e.validator_value, dict) else {}
        return sub.get("description") or e.message
    if e.validator not in ("oneOf", "anyOf"):
        return e.message
    if e.validator == "oneOf" and isinstance(e.instance, dict) and "type" in e.instance:
        # answer types: report the errors of the branch whose `type` matched
        branches: dict[Any, list[Any]] = {}
        for sub in e.context or []:
            branches.setdefault(sub.relative_schema_path[0], []).append(sub)
        for errs in branches.values():
            if not any(s.validator == "const" and list(s.relative_path) == ["type"] for s in errs):
                return f"invalid {e.instance['type']} answer: " + "; ".join(_readable(s) for s in errs)
    if isinstance(e.schema, dict) and e.schema.get("description"):
        return e.schema["description"]
    return "does not match any allowed form"


def check_contract_version(report: Report, file: str, version: str) -> None:
    m = re.match(r"^(\d+)\.(\d+)\.(\d+)$", version or "")
    if not m:
        return  # schema already reports the pattern
    major, minor = int(m[1]), int(m[2])
    if major != SUPPORTED_MAJOR:
        report.error(file, "/contract_version", f"contract major {major} is not supported (this is v{SUPPORTED_MAJOR})")
    elif minor > SUPPORTED_MINOR:
        report.error(file, "/contract_version", f"contract {version} is newer than this validator (1.{SUPPORTED_MINOR}); update the tooling")


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def _code_slug(code: str) -> str:
    return code.replace(".", "-")


def validate_bundle(root: Path) -> tuple[Report, dict[str, Any]]:
    """Validate a bundle directory. Returns the report and the parsed files by kind (for the importer)."""
    report = Report()
    parsed: dict[str, list[tuple[str, Any]]] = {k: [] for k in KIND_SCHEMA}
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        report.error("manifest.json", "", "missing at the bundle root")
        return report, {"manifest": None, **parsed}
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        report.error("manifest.json", "", f"not valid UTF-8 JSON: {exc}")
        return report, {"manifest": None, **parsed}
    if not _schema_errors(report, "manifest.json", manifest, "manifest.schema.json"):
        return report, {"manifest": manifest, **parsed}
    check_contract_version(report, "manifest.json", manifest["contract_version"])

    seen_paths: set[str] = set()
    for i, entry in enumerate(manifest["files"]):
        rel = entry["path"]
        where = f"/files/{i}"
        if rel in seen_paths:
            report.error("manifest.json", where, f"'{rel}' listed twice")
            continue
        seen_paths.add(rel)
        path = root / rel
        if not path.is_file():
            report.error("manifest.json", where, f"file '{rel}' does not exist")
            continue
        if sha256_of(path) != entry["sha256"]:
            report.error(rel, "", "SHA-256 does not match the manifest (file changed after the manifest was written?)")
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            report.error(rel, "", f"not valid UTF-8 JSON: {exc}")
            continue
        if not _schema_errors(report, rel, data, KIND_SCHEMA[entry["kind"]]):
            continue
        if data.get("kind") != entry["kind"]:
            report.error(rel, "/kind", f"manifest says '{entry['kind']}' but the file says '{data.get('kind')}'")
            continue
        check_contract_version(report, rel, data["contract_version"])
        parsed[entry["kind"]].append((rel, data))

    _semantic_checks(report, root, parsed)
    report.counts = {
        "subjects": sum(1 for _ in parsed["curriculum"]),
        "lessons": sum(len(d["lessons"]) for _, d in parsed["lessons"]),
        "exercises": sum(len(d["exercises"]) for _, d in parsed["exercises"]),
        "documents": sum(len(d["documents"]) for _, d in parsed["documents"]),
    }
    return report, {"manifest": manifest, **parsed}


def _semantic_checks(report: Report, root: Path, parsed: dict[str, list[tuple[str, Any]]]) -> None:
    all_ids: dict[str, str] = {}

    def claim(item_id: str, file: str, where: str) -> None:
        if item_id in all_ids:
            report.error(file, where, f"id '{item_id}' already used in {all_ids[item_id]}")
        else:
            all_ids[item_id] = file

    # ---- curriculum: conventions + index of standards
    chapters: dict[str, dict[str, Any]] = {}  # chapter id -> {subject, form}
    standards: dict[str, dict[str, Any]] = {}  # learning standard id -> {subject, form, chapter}
    subjects_seen: dict[str, str] = {}
    for file, doc in parsed["curriculum"]:
        subject = doc["subject"]["id"]
        if subject in subjects_seen:
            report.error(file, "/subject/id", f"subject '{subject}' is also defined in {subjects_seen[subject]}")
        subjects_seen[subject] = file
        for fi, form in enumerate(doc["forms"]):
            for ci, ch in enumerate(form["chapters"]):
                cw = f"/forms/{fi}/chapters/{ci}"
                expected = f"{subject}-f{form['form']}-c{ch['number']:02d}"
                if ch["id"] != expected:
                    report.error(file, cw + "/id", f"chapter id should be '{expected}'")
                claim(ch["id"], file, cw + "/id")
                chapters[ch["id"]] = {"subject": subject, "form": form["form"]}
                for si, cs in enumerate(ch["content_standards"]):
                    sw = f"{cw}/content_standards/{si}"
                    if cs["id"] != f"{ch['id']}-cs-{_code_slug(cs['code'])}":
                        report.error(file, sw + "/id", f"content standard id should be '{ch['id']}-cs-{_code_slug(cs['code'])}'")
                    if not cs["code"].startswith(f"{ch['number']}."):
                        report.error(file, sw + "/code", f"code {cs['code']} does not belong to chapter {ch['number']}")
                    claim(cs["id"], file, sw + "/id")
                    for li, ls in enumerate(cs["learning_standards"]):
                        lw = f"{sw}/learning_standards/{li}"
                        if ls["id"] != f"{ch['id']}-ls-{_code_slug(ls['code'])}":
                            report.error(file, lw + "/id", f"learning standard id should be '{ch['id']}-ls-{_code_slug(ls['code'])}'")
                        if not ls["code"].startswith(cs["code"] + "."):
                            report.error(file, lw + "/code", f"code {ls['code']} does not belong to content standard {cs['code']}")
                        claim(ls["id"], file, lw + "/id")
                        standards[ls["id"]] = {"subject": subject, "form": form["form"], "chapter": ch["id"]}

    def check_standards(file: str, where: str, subject: str, form: int, ids: list[str], chapter: str | None = None) -> None:
        for k, sid in enumerate(ids):
            info = standards.get(sid)
            if info is None:
                report.warning(file, f"{where}/{k}", f"learning standard '{sid}' is not in this bundle (must already exist in the database)")
            elif (info["subject"], info["form"]) != (subject, form) or (chapter and info["chapter"] != chapter):
                report.error(file, f"{where}/{k}", f"learning standard '{sid}' belongs to {info['subject']} form {info['form']} {info['chapter']}")

    # ---- exercises
    exercises: dict[str, dict[str, Any]] = {}
    for file, doc in parsed["exercises"]:
        for i, ex in enumerate(doc["exercises"]):
            w = f"/exercises/{i}"
            claim(ex["id"], file, w + "/id")
            exercises[ex["id"]] = ex
            check_standards(file, w + "/learning_standards", ex["subject"], ex["form"], ex["learning_standards"])
            _check_answer_text(report, file, w + "/answer", ex["answer"])
            _check_review(report, file, w, ex)

    # ---- lessons
    for file, doc in parsed["lessons"]:
        for i, lesson in enumerate(doc["lessons"]):
            w = f"/lessons/{i}"
            claim(lesson["id"], file, w + "/id")
            ch = chapters.get(lesson["chapter"])
            if ch is None:
                report.warning(file, w + "/chapter", f"chapter '{lesson['chapter']}' is not in this bundle (must already exist in the database)")
            elif (ch["subject"], ch["form"]) != (lesson["subject"], lesson["form"]):
                report.error(file, w + "/chapter", f"chapter '{lesson['chapter']}' is {ch['subject']} form {ch['form']}")
            check_standards(file, w + "/learning_standards", lesson["subject"], lesson["form"], lesson["learning_standards"], lesson["chapter"])
            for k, ex_id in enumerate(lesson["exercises"]):
                ex = exercises.get(ex_id)
                if ex is None:
                    report.warning(file, f"{w}/exercises/{k}", f"exercise '{ex_id}' is not in this bundle (must already exist in the database)")
                elif (ex["subject"], ex["form"]) != (lesson["subject"], lesson["form"]):
                    report.error(file, f"{w}/exercises/{k}", f"exercise '{ex_id}' is {ex['subject']} form {ex['form']}")
            _check_review(report, file, w, lesson)

    # ---- documents
    for file, doc in parsed["documents"]:
        for i, d in enumerate(doc["documents"]):
            w = f"/documents/{i}"
            claim(d["id"], file, w + "/id")
            payload = root / d["path"]
            if not payload.is_file():
                report.error(file, w + "/path", f"payload '{d['path']}' does not exist")
            else:
                if sha256_of(payload) != d["sha256"]:
                    report.error(file, w + "/sha256", "does not match the payload file")
                if not payload.name.lower().endswith(SUFFIX_FOR_MEDIA[d["media_type"]]):
                    report.error(file, w + "/path", f"extension does not match media type {d['media_type']}")
            if "form" in d:
                check_standards(file, w + "/learning_standards", d["subject"], d["form"], d.get("learning_standards", []))
            elif d.get("learning_standards"):
                report.error(file, w + "/learning_standards", "documents tagged with learning standards must also set `form`")
            _check_review(report, file, w, d)


def _check_answer_text(report: Report, file: str, where: str, answer: dict[str, Any]) -> None:
    texts: list[tuple[str, str]] = []
    t = answer["type"]
    if t in ("expression", "numeric"):
        texts.append(("/expected", answer["expected"]))
    elif t == "solution_set":
        for k, sol in enumerate(answer["solutions"]):
            if set(sol) != set(answer["variables"]):
                report.error(file, f"{where}/solutions/{k}", f"must give a value for exactly {answer['variables']}")
            texts += [(f"/solutions/{k}/{v}", val) for v, val in sol.items()]
    elif t == "multiple_choice":
        ids = [o["id"] for o in answer["options"]]
        if len(set(ids)) != len(ids):
            report.error(file, f"{where}/options", "option ids must be unique")
        for c in answer["correct"]:
            if c not in ids:
                report.error(file, f"{where}/correct", f"'{c}' is not an option id")
    for sub, text in texts:
        if not MATH_TEXT.match(text):
            report.error(file, where + sub, f"'{text}' uses characters outside the dataset math syntax (SPEC.md §5)")
        if re.search(r"\blog\s*\(", text) and not re.search(r"\blog\s*\([^()]*,", text):
            report.error(file, where + sub, "bare log(x) is ambiguous: use ln(x), log10(x) or log(x, base)")


def _check_review(report: Report, file: str, where: str, item: dict[str, Any]) -> None:
    review, source = item["review"], item["source"]
    if review["status"] == "approved" and source.get("generated_with") and not review.get("notes"):
        report.warning(file, where + "/review", "AI-drafted content marked approved: add review notes describing what the reviewer checked")


def update_hashes(root: Path) -> list[str]:
    """Rewrite every SHA-256 in documents files and the manifest from the files on disk (authoring helper)."""
    changed: list[str] = []
    manifest_path = root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for entry in manifest["files"]:
        path = root / entry["path"]
        if entry["kind"] == "documents" and path.is_file():
            doc = json.loads(path.read_text(encoding="utf-8"))
            for d in doc.get("documents", []):
                payload = root / d["path"]
                if payload.is_file() and d.get("sha256") != (h := sha256_of(payload)):
                    d["sha256"] = h
                    changed.append(d["path"])
            _write_json(path, doc)
        if path.is_file() and entry.get("sha256") != (h := sha256_of(path)):
            entry["sha256"] = h
            changed.append(entry["path"])
    _write_json(manifest_path, manifest)
    return changed


def _write_json(path: Path, data: Any) -> None:
    # LF line endings on every platform, so hashes are stable (see .gitattributes)
    path.write_bytes((json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--json", action="store_true", help="print a JSON report")
    parser.add_argument("--update-hashes", action="store_true", help="recompute SHA-256s in the manifest and documents files, then validate")
    args = parser.parse_args(argv)
    if args.update_hashes:
        for path in update_hashes(args.bundle):
            print(f"updated hash: {path}")
    report, _ = validate_bundle(args.bundle)
    if args.json:
        print(json.dumps(report.to_json(), indent=2, ensure_ascii=False))
    else:
        for issue in report.issues:
            print(issue)
        status = "OK" if report.ok else "FAILED"
        errors = sum(1 for i in report.issues if i.level == "error")
        warnings = len(report.issues) - errors
        print(f"{status}: {errors} error(s), {warnings} warning(s); {report.counts}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
