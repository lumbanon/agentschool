"""Deterministic answer verification with SymPy (no AI involved).

`verify(answer_spec, student_text)` -> Verdict. The answer spec is the `answer`
object of an exercise in the import contract (SPEC.md §8). Every answer type
has a student-input parser that yields a canonical value, and an equality
test on those values; the same parser reads `common_mistakes` so matching
feedback works for every type.

Pure and side-effect free. In the API it runs in a worker process with a
timeout (see sandbox.py).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, Callable

import sympy as sp

from .parsing import Context, ParseError, normalize, parse_math, split_top_level, to_latex

VERIFIER_VERSION = f"agentschool-verifier/1.0 sympy/{sp.__version__}"

CORRECT = "correct"
INCORRECT = "incorrect"
INVALID = "invalid_input"  # could not read the answer: not marked wrong
NOT_VERIFIABLE = "not_verifiable"  # manual answer type


@dataclass
class Verdict:
    status: str
    message: str
    #: Normalised reading of the answer, as LaTeX (so the student sees how it was understood).
    interpreted: str | None = None
    #: Feedback from a matching `common_mistakes` entry (localized text object).
    mistake_feedback: dict[str, str] | None = None
    details: dict[str, Any] = field(default_factory=dict)

    @property
    def correct(self) -> bool | None:
        if self.status in (CORRECT, INCORRECT):
            return self.status == CORRECT
        return None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "correct": self.correct,
            "message": self.message,
            "interpreted": self.interpreted,
            "mistake_feedback": self.mistake_feedback,
            "verifier": VERIFIER_VERSION,
        }


class SpecError(ValueError):
    """The exercise's answer spec itself is unusable (caught at import time)."""


# ------------------------------------------------------------------ helpers

def _same_value(a: sp.Expr, b: sp.Expr) -> bool:
    """Exact mathematical equality of two numbers or expressions."""
    if a == b:
        return True
    try:
        diff = sp.simplify(a - b)
        if diff == 0:
            return True
        eq = sp.Eq(a, b).simplify() if not diff.free_symbols else None
        if eq is sp.true:
            return True
        # last resort for expressions: numeric spot checks at several points
        if diff.free_symbols:
            return _spot_check_zero(diff)
        return bool(abs(sp.N(diff, 30)) < sp.Float("1e-25"))
    except Exception:
        return False


def _spot_check_zero(expr: sp.Expr) -> bool:
    syms = sorted(expr.free_symbols, key=str)
    points = [sp.Rational(n, 7) for n in (3, 11, 17, 23, -5, 29)]
    for k in range(len(points)):
        subs = {s: points[(k + i) % len(points)] for i, s in enumerate(syms)}
        try:
            v = sp.N(expr.subs(subs), 30)
        except Exception:
            return False
        if v.is_real is False or not v.is_finite or abs(v) > sp.Float("1e-20"):
            return False
    return True


_OR = re.compile(r"\s*(?:\bor\b|\batau\b|;)\s*", re.I)
_AND = re.compile(r"\s*(?:\band\b|\bdan\b|,)\s*", re.I)
_NO_SOLUTION = re.compile(r"^\s*(no( real)? solutions?|tiada penyelesaian|tiada punca( nyata)?|none|\{\s*\}|∅)\s*$", re.I)


def _mistake_feedback(spec: dict[str, Any], student: Any, same: Callable[[Any, Any], bool], read: Callable[[str], Any]) -> dict[str, str] | None:
    for m in spec.get("_common_mistakes", []):
        try:
            if same(student, read(m["answer"])):
                return m["feedback"]
        except ParseError:
            continue
    return None


# ------------------------------------------------------------------ solution_set

def _read_solution_set(spec: dict[str, Any], text: str) -> list[dict[str, sp.Expr]]:
    variables: list[str] = spec["variables"]
    ctx = Context(tuple(variables))
    text = normalize(text)
    if _NO_SOLUTION.match(text):
        return []
    solutions: list[dict[str, sp.Expr]] = []
    if len(variables) == 1:
        (var,) = variables
        for part in split_top_level(text, re.compile(r"\s*(?:\bor\b|\batau\b|\band\b|\bdan\b|[,;])\s*", re.I)):
            lhs, _, rhs = part.partition("=")
            if _:
                if lhs.strip() != var:
                    raise ParseError(f"Write each solution as {var} = value.")
                part = rhs
            value = parse_math(part, Context(()))
            solutions.append({var: value})
    else:
        for group in split_top_level(text, _OR):
            group = group.strip()
            if group.startswith("(") and group.endswith(")") and "=" not in group:
                values = split_top_level(group[1:-1], re.compile(r"\s*,\s*"))
                if len(values) != len(variables):
                    raise ParseError(f"Give {len(variables)} values in the order ({', '.join(variables)}).")
                solutions.append({v: parse_math(val, Context(())) for v, val in zip(variables, values)})
                continue
            sol: dict[str, sp.Expr] = {}
            for assignment in split_top_level(group, _AND):
                lhs, eq, rhs = assignment.partition("=")
                if not eq or lhs.strip() not in variables:
                    raise ParseError(f"Write each solution as {variables[0]} = …, {variables[1]} = …")
                sol[lhs.strip()] = parse_math(rhs, Context(()))
            if set(sol) != set(variables):
                raise ParseError(f"Each solution needs a value for {', '.join(variables)}.")
            solutions.append(sol)
    for sol in solutions:
        for value in sol.values():
            if value.free_symbols:
                raise ParseError("Each solution must be a number.")
            if value.is_real is False:
                raise ParseError("Only real solutions are expected.")
    _ = ctx  # variables already validated per assignment
    return solutions


def _same_solution_sets(a: list[dict[str, sp.Expr]], b: list[dict[str, sp.Expr]]) -> bool:
    def dedupe(sols: list[dict[str, sp.Expr]]) -> list[dict[str, sp.Expr]]:
        out: list[dict[str, sp.Expr]] = []
        for s in sols:
            if not any(all(_same_value(s[k], o[k]) for k in s) for o in out):
                out.append(s)
        return out

    a, b = dedupe(a), dedupe(b)
    if len(a) != len(b):
        return False
    remaining = list(b)
    for s in a:
        match = next((o for o in remaining if all(_same_value(s[k], o[k]) for k in s)), None)
        if match is None:
            return False
        remaining.remove(match)
    return True


def _verify_solution_set(spec: dict[str, Any], text: str) -> Verdict:
    expected = _expected_solutions(spec)
    student = _read_solution_set(spec, text)
    shown = " \\text{ or } ".join(", ".join(f"{k} = {to_latex(v)}" for k, v in s.items()) for s in student) or "\\text{no solution}"
    if _same_solution_sets(student, expected):
        return Verdict(CORRECT, "Correct.", shown)
    fb = _mistake_feedback(spec, student, _same_solution_sets, lambda t: _read_solution_set(spec, t))
    hint = ""
    if len(student) < len(expected):
        hint = " Check whether there are more solutions."
    elif len(student) > len(expected):
        hint = " Check every value: at least one is not a solution."
    return Verdict(INCORRECT, "Not quite." + hint, shown, fb)


def _expected_solutions(spec: dict[str, Any]) -> list[dict[str, sp.Expr]]:
    try:
        return [{k: parse_math(v, Context(())) for k, v in sol.items()} for sol in spec["solutions"]]
    except ParseError as exc:
        raise SpecError(f"expected solution does not parse: {exc}") from exc


# ------------------------------------------------------------------ expression

def _is_factored(expr: sp.Expr, variables: list[sp.Symbol]) -> bool:
    """A product (or power) whose non-constant factors are all irreducible over the rationals."""
    factors: list[sp.Expr] = []
    for f in sp.Mul.make_args(expr):
        base = f.base if isinstance(f, sp.Pow) and f.exp.is_Integer and f.exp > 0 else f
        if base.free_symbols:
            factors.append(base)
    if not factors:
        return False
    for base in factors:
        try:
            poly = sp.Poly(base, *variables)
        except sp.PolynomialError:
            return False
        if poly.total_degree() < 1:
            return False
        _, flist = sp.factor_list(poly)
        if len(flist) != 1 or flist[0][1] != 1:
            return False
    # a single linear factor written alone counts only if the target is linear too (checked by equivalence)
    return True


def _is_expanded(expr: sp.Expr) -> bool:
    return expr == sp.expand(expr)


def _verify_expression(spec: dict[str, Any], text: str) -> Verdict:
    ctx = Context(tuple(spec["variables"]))
    try:
        expected = parse_math(spec["expected"], ctx)
    except ParseError as exc:
        raise SpecError(f"expected expression does not parse: {exc}") from exc
    student = parse_math(text, ctx)
    shown = to_latex(student)
    equal = _same_value(student, expected)
    form = spec.get("form", "equivalent")
    syms = [sp.Symbol(v, real=True) for v in spec["variables"]]
    if equal and form == "factored" and not _is_factored(student, syms):
        return Verdict(INCORRECT, "That is equal, but not fully factorised: write it as a product of factors.", shown, details={"equal": True})
    if equal and form == "expanded" and not _is_expanded(student):
        return Verdict(INCORRECT, "That is equal, but not expanded: remove the brackets.", shown, details={"equal": True})
    if equal:
        return Verdict(CORRECT, "Correct.", shown)
    read = lambda t: parse_math(t, ctx)  # noqa: E731
    # mistakes: compare as written expressions (structure), so 'x^2 - 5x + 6' can be flagged for a factorise task
    fb = _mistake_feedback(spec, student, lambda a, b: a == b or _same_value(a, b), read)
    return Verdict(INCORRECT, "Not quite.", shown, fb)


# ------------------------------------------------------------------ numeric

_UNIT_SPLIT = re.compile(r"^\s*(?P<num>[-+]?\s*[0-9.()/*^+\-\s√pie]*?[0-9)])\s*(?P<unit>[A-Za-zµΩ°%][A-Za-z0-9µΩ°%^\-/·*() ]*)?\s*$")


def _norm_unit(u: str) -> str:
    u = normalize(u).replace("·", " ").replace("*", " ")
    u = re.sub(r"\s+", " ", u).strip()
    u = re.sub(r"\^\s*\(?\s*(-?\d+)\s*\)?", r"^\1", u)  # ^(-1) -> ^-1
    return u.replace(" ", "")


def _read_numeric(spec: dict[str, Any], text: str) -> tuple[sp.Expr, str | None, str]:
    text = normalize(text)
    m = _UNIT_SPLIT.match(text)
    if not m:
        raise ParseError("Write a number, followed by its unit if there is one.")
    num_text = m.group("num").strip()
    value = parse_math(num_text, Context(()))
    if value.free_symbols:
        raise ParseError("Write a number.")
    return value, (m.group("unit") or "").strip() or None, num_text


def _decimals_of(num_text: str) -> int | None:
    t = num_text.replace(" ", "")
    if not re.fullmatch(r"[-+]?\d+(\.\d+)?", t):
        return None
    return len(t.split(".")[1]) if "." in t else 0


def _round_dp(x: sp.Expr, dp: int) -> Decimal:
    return Decimal(str(sp.N(x, 40))).quantize(Decimal(1).scaleb(-dp), rounding=ROUND_HALF_UP)


def _round_sf(x: sp.Expr, sf: int) -> Decimal:
    d = Decimal(str(sp.N(x, 40)))
    if d == 0:
        return d
    exp = d.adjusted() - sf + 1
    return d.quantize(Decimal(1).scaleb(exp), rounding=ROUND_HALF_UP)


def _sig_figs(num_text: str) -> int | None:
    t = num_text.replace(" ", "").lstrip("+-")
    if not re.fullmatch(r"\d+(\.\d+)?", t):
        return None
    digits = t.replace(".", "").lstrip("0")
    if "." not in t:
        digits = digits.rstrip("0") or digits  # trailing zeros in integers are ambiguous: not counted
    return len(digits)


def _verify_numeric(spec: dict[str, Any], text: str) -> Verdict:
    try:
        expected = parse_math(spec["expected"], Context(()))
    except ParseError as exc:
        raise SpecError(f"expected value does not parse: {exc}") from exc
    if expected.free_symbols or not expected.is_real:
        raise SpecError("expected value must be a real number")
    value, unit, num_text = _read_numeric(spec, text)
    shown = to_latex(value) + (f"\\ \\text{{{unit}}}" if unit else "")

    want_unit = spec.get("unit")
    if want_unit:
        accepted = {_norm_unit(u) for u in [want_unit, *spec.get("accepted_units", [])]}
        if not unit:
            return Verdict(INCORRECT, f"Include the unit ({want_unit}).", shown, details={"unit": "missing"})
        if _norm_unit(unit) not in accepted:
            return Verdict(INCORRECT, f"Check the unit: expected {want_unit}.", shown, details={"unit": "wrong"})
    elif unit:
        return Verdict(INVALID, "This answer has no unit: give just the number.", shown)

    dp, sf = spec.get("decimal_places"), spec.get("significant_figures")
    try:
        if dp is not None:
            if _decimals_of(num_text) != dp:
                return Verdict(INCORRECT, f"Give your answer to {dp} decimal place{'s' if dp != 1 else ''}.", shown)
            ok = Decimal(num_text.replace(" ", "")) == _round_dp(expected, dp)
        elif sf is not None:
            if _sig_figs(num_text) != sf:
                return Verdict(INCORRECT, f"Give your answer to {sf} significant figure{'s' if sf != 1 else ''}.", shown)
            ok = Decimal(num_text.replace(" ", "")) == _round_sf(expected, sf)
        else:
            tol = spec.get("tolerance") or {}
            diff = abs(sp.N(value - expected, 30))
            if not tol:
                ok = _same_value(value, expected)
            else:
                ok = bool(
                    ("absolute" in tol and diff <= tol["absolute"])
                    or ("relative" in tol and diff <= tol["relative"] * abs(sp.N(expected, 30)))
                )
    except (InvalidOperation, ValueError):
        return Verdict(INVALID, "Could not read that number.", shown)
    if ok:
        return Verdict(CORRECT, "Correct.", shown)
    fb = _mistake_feedback(spec, value, lambda a, b: _same_value(a, b[0] if isinstance(b, tuple) else b), lambda t: _read_numeric(spec, t)[0])
    return Verdict(INCORRECT, "Not quite.", shown, fb)


# ------------------------------------------------------------------ inequality

_REL = re.compile(r"(<=|>=|<|>)")
_REL_FN = {"<": sp.Lt, "<=": sp.Le, ">": sp.Gt, ">=": sp.Ge}


def _read_inequality(spec: dict[str, Any], text: str) -> sp.Set:
    var = spec["variable"]
    ctx = Context((var,))
    x = ctx.symbols()[var]
    text = normalize(text)
    union: sp.Set = sp.S.EmptySet
    for alt in split_top_level(text, _OR):
        inter: sp.Set = sp.S.Reals
        for clause in split_top_level(alt, _AND):
            pieces = _REL.split(clause)
            if len(pieces) < 3 or len(pieces) % 2 == 0:
                raise ParseError(f"Write it like -2 < {var} < 3 or {var} < -2 or {var} > 3.")
            terms = [parse_math(p, ctx) for p in pieces[0::2]]
            ops = pieces[1::2]
            if len(ops) > 2:
                raise ParseError("At most two comparisons in a row.")
            for left, op, right in zip(terms, ops, terms[1:]):
                rel = _REL_FN[op](left, right)
                if not rel.free_symbols & {x}:
                    raise ParseError(f"Each comparison should involve {var}.")
                try:
                    inter = sp.Intersection(inter, sp.solveset(rel, x, domain=sp.S.Reals))
                except Exception as exc:
                    raise ParseError("Could not read that inequality.") from exc
        union = sp.Union(union, inter)
    return sp.simplify(union) if not isinstance(union, sp.Interval) else union


def _same_set(a: sp.Set, b: sp.Set) -> bool:
    try:
        return sp.Complement(a, b) == sp.S.EmptySet and sp.Complement(b, a) == sp.S.EmptySet
    except Exception:
        return a == b


def _verify_inequality(spec: dict[str, Any], text: str) -> Verdict:
    try:
        expected = _read_inequality(spec, spec["expected"])
    except ParseError as exc:
        raise SpecError(f"expected inequality does not parse: {exc}") from exc
    student = _read_inequality(spec, text)
    shown = to_latex(student)
    if _same_set(student, expected):
        return Verdict(CORRECT, "Correct.", shown)
    fb = _mistake_feedback(spec, student, _same_set, lambda t: _read_inequality(spec, t))
    return Verdict(INCORRECT, "Not quite.", shown, fb)


# ------------------------------------------------------------------ equation

def _read_equation(spec: dict[str, Any], text: str) -> sp.Expr:
    ctx = Context(tuple(spec["variables"]))
    text = normalize(text)
    sides = split_top_level(text, re.compile(r"="))
    if text.count("=") != 1 or len(sides) != 2:
        raise ParseError("Write an equation with one '=' sign.")
    lhs, rhs = (parse_math(s, ctx) for s in sides)
    return sp.expand(lhs - rhs)


def _same_equation(a: sp.Expr, b: sp.Expr) -> bool:
    """Same solution set: one side-difference is a non-zero constant multiple of the other."""
    if a == 0 or b == 0:
        return a == b
    try:
        ratio = sp.simplify(a / b)
    except Exception:
        return False
    return bool(ratio.is_number and ratio != 0 and ratio.is_finite)


def _verify_equation(spec: dict[str, Any], text: str) -> Verdict:
    try:
        expected = _read_equation(spec, spec["expected"])
    except ParseError as exc:
        raise SpecError(f"expected equation does not parse: {exc}") from exc
    student = _read_equation(spec, text)
    shown = to_latex(sp.Eq(student, 0))
    if _same_equation(student, expected):
        return Verdict(CORRECT, "Correct.", shown)
    fb = _mistake_feedback(spec, student, _same_equation, lambda t: _read_equation(spec, t))
    return Verdict(INCORRECT, "Not quite.", shown, fb)


# ------------------------------------------------------------------ multiple choice / manual

def _read_choice(spec: dict[str, Any], text: str) -> frozenset[str]:
    ids = {o["id"] for o in spec["options"]}
    picked = frozenset(p.upper() for p in re.split(r"[\s,;/]+|\band\b|\bdan\b", text.strip(), flags=re.I) if p)
    if not picked:
        raise ParseError("Choose an option.")
    unknown = picked - ids
    if unknown:
        raise ParseError(f"Unknown option {', '.join(sorted(unknown))}.")
    return picked


def _verify_choice(spec: dict[str, Any], text: str) -> Verdict:
    picked = _read_choice(spec, text)
    shown = ", ".join(sorted(picked))
    if picked == frozenset(spec["correct"]):
        return Verdict(CORRECT, "Correct.", shown)
    fb = _mistake_feedback(spec, picked, lambda a, b: a == b, lambda t: _read_choice(spec, t))
    return Verdict(INCORRECT, "Not quite.", shown, fb)


def _verify_manual(spec: dict[str, Any], text: str) -> Verdict:
    if not text.strip():
        return Verdict(INVALID, "Write your answer first.")
    return Verdict(NOT_VERIFIABLE, "Answer recorded. This question is not checked automatically.")


VERIFIERS: dict[str, Callable[[dict[str, Any], str], Verdict]] = {
    "solution_set": _verify_solution_set,
    "expression": _verify_expression,
    "numeric": _verify_numeric,
    "inequality": _verify_inequality,
    "equation": _verify_equation,
    "multiple_choice": _verify_choice,
    "manual": _verify_manual,
}


def verify(answer: dict[str, Any], student_text: str, common_mistakes: list[dict[str, Any]] | None = None) -> Verdict:
    """Verify one student answer. Raises SpecError only if the exercise data itself is broken."""
    fn = VERIFIERS.get(answer.get("type", ""))
    if fn is None:
        raise SpecError(f"unknown answer type {answer.get('type')!r}")
    spec = {**answer, "_common_mistakes": common_mistakes or []}
    try:
        return fn(spec, student_text)
    except ParseError as exc:
        return Verdict(INVALID, str(exc))


def canonical_answer_text(answer: dict[str, Any]) -> str:
    """A student-style rendering of the expected answer (used by the importer's self-check)."""
    t = answer["type"]
    if t == "solution_set":
        if not answer["solutions"]:
            return "no solution"
        return " or ".join(", ".join(f"{k} = {v}" for k, v in sol.items()) for sol in answer["solutions"])
    if t in ("expression", "inequality", "equation"):
        return answer["expected"]
    if t == "numeric":
        value = answer["expected"]
        if answer.get("decimal_places") is not None:
            value = str(_round_dp(parse_math(value, Context(())), answer["decimal_places"]))
        elif answer.get("significant_figures") is not None:
            value = format(_round_sf(parse_math(value, Context(())), answer["significant_figures"]), "f")
        return f"{value} {answer['unit']}" if answer.get("unit") else value
    if t == "multiple_choice":
        return ", ".join(answer["correct"])
    return "recorded"
