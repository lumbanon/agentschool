"""Safe parsing of maths typed by students (and written in datasets) into SymPy.

SymPy's `parse_expr` evaluates generated Python code, so input is never handed
to it raw. Every input is first:

1. normalised (Unicode maths symbols, whitespace),
2. tokenised against a strict whitelist (numbers, declared variables, a fixed
   set of function names, operators) — anything else is rejected,
3. size-limited (length, number of digits, nesting depth),
4. parsed *unevaluated* and checked structurally (no huge exponents such as
   9^9^9 that would hang evaluation), and only then evaluated.

Syntax: docs/contracts/curriculum-import/v1/SPEC.md §5.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

MAX_INPUT = 300
MAX_DIGITS = 30
MAX_DEPTH = 30
MAX_EXPONENT = 100

FUNCTIONS: dict[str, object] = {
    "sqrt": sp.sqrt,
    "abs": sp.Abs,
    "ln": sp.log,  # natural log
    "log10": lambda x: sp.log(x, 10),
    "log": sp.log,  # only valid with an explicit base: log(x, b)
    "exp": sp.exp,
    "sin": sp.sin,
    "cos": sp.cos,
    "tan": sp.tan,
}
CONSTANTS: dict[str, object] = {"pi": sp.pi, "e": sp.E}
VARIABLE = re.compile(r"^[a-zA-Z](_[0-9a-zA-Z]+)?$")

_UNICODE = {
    "−": "-",  # minus sign
    "–": "-",  # en dash
    "×": "*",  # ×
    "⋅": "*",  # ⋅
    "·": "*",  # ·
    "÷": "/",  # ÷
    "π": "pi",  # π
    "≤": "<=",
    "≥": ">=",
    "≠": "!=",
    "²": "^2",
    "³": "^3",
    "＝": "=",
}
_TOKEN = re.compile(
    r"\s+|(?P<num>\d+(?:\.\d+)?|\.\d+)|(?P<name>[A-Za-z][A-Za-z0-9_]*)|(?P<op>\*\*|<=|>=|!=|[-+*/^()=<>,√])"
)
_TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)


class ParseError(ValueError):
    """Input the verifier cannot read. `message` is safe to show to a student."""


def normalize(text: str) -> str:
    if not isinstance(text, str):
        raise ParseError("Answer must be text.")
    text = text.strip()
    if len(text) > MAX_INPUT:
        raise ParseError(f"Answer is too long (max {MAX_INPUT} characters).")
    for a, b in _UNICODE.items():
        text = text.replace(a, b)
    # √x / √(x+1) -> sqrt(x) / sqrt(x+1)
    text = re.sub(r"√\s*\(", "sqrt(", text)
    text = re.sub(r"√\s*([A-Za-z0-9_.]+)", r"sqrt(\1)", text)
    return re.sub(r"\s+", " ", text)


def tokens(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    pos = 0
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m:
            raise ParseError(f"Unexpected character '{text[pos]}'.")
        pos = m.end()
        if m.lastgroup:
            out.append((m.lastgroup, m.group(m.lastgroup)))
    return out


@dataclass(frozen=True)
class Context:
    """Which variable names are allowed in an answer."""

    variables: tuple[str, ...]

    def symbols(self) -> dict[str, sp.Symbol]:
        return {v: sp.Symbol(v, real=True) for v in self.variables}


def _check_tokens(toks: list[tuple[str, str]], ctx: Context) -> None:
    depth = 0
    for i, (kind, value) in enumerate(toks):
        if kind == "num" and len(value.replace(".", "")) > MAX_DIGITS:
            raise ParseError("Number is too long.")
        if kind == "name":
            if value in FUNCTIONS:
                nxt = toks[i + 1] if i + 1 < len(toks) else None
                if nxt != ("op", "("):
                    raise ParseError(f"'{value}' needs brackets, e.g. {value}(x).")
            elif value not in CONSTANTS and value not in ctx.variables:
                allowed = ", ".join(ctx.variables) or "none"
                raise ParseError(f"Unknown name '{value}' (variables here: {allowed}).")
        if value == "(":
            depth += 1
            if depth > MAX_DEPTH:
                raise ParseError("Too many nested brackets.")
        elif value == ")":
            depth -= 1
            if depth < 0:
                raise ParseError("Unbalanced brackets.")
    if depth != 0:
        raise ParseError("Unbalanced brackets.")
    if not toks:
        raise ParseError("Answer is empty.")


def _check_structure(expr: sp.Basic) -> None:
    """Reject expressions whose evaluation could be enormous (e.g. 9^9^9)."""
    for node in sp.preorder_traversal(expr):
        if isinstance(node, sp.Pow):
            base, exponent = node.args
            if exponent.free_symbols:
                continue  # symbolic exponent such as 2^x: fine
            if not exponent.is_Number:
                raise ParseError("Exponent is too complicated; simplify it first.")
            if abs(exponent) > MAX_EXPONENT:
                raise ParseError(f"Exponent is too large (max {MAX_EXPONENT}).")


def _local_dict(ctx: Context) -> dict[str, object]:
    return {**FUNCTIONS, **CONSTANTS, **ctx.symbols()}


def parse_math(text: str, ctx: Context) -> sp.Expr:
    """Parse one expression (no '=' or comparisons)."""
    toks = _split_variable_products(tokens(normalize(text)), ctx)
    _check_tokens(toks, ctx)
    text = " ".join(v for _, v in toks)
    if any(k == "op" and v in ("=", "<", ">", "<=", ">=", "!=") for k, v in toks):
        raise ParseError("Expected a single expression here.")
    depth = 0
    for _, v in toks:  # commas only separate function arguments, e.g. log(8, 2)
        depth += v == "("
        depth -= v == ")"
        if v == "," and depth == 0:
            raise ParseError("Expected a single expression here.")
    _forbid_bare_log(toks)
    local = _local_dict(ctx)
    try:
        raw = parse_expr(text, local_dict=local, global_dict=_GLOBALS, transformations=_TRANSFORMS, evaluate=False)
        _check_structure(raw)
        expr = parse_expr(text, local_dict=local, global_dict=_GLOBALS, transformations=_TRANSFORMS, evaluate=True)
    except ParseError:
        raise
    except Exception as exc:  # SymPy raises many types for malformed input
        raise ParseError("Could not read that as maths.") from exc
    if not isinstance(expr, sp.Expr):
        raise ParseError("Could not read that as maths.")
    return expr


def _split_variable_products(toks: list[tuple[str, str]], ctx: Context) -> list[tuple[str, str]]:
    """Students write 'xy' for x*y: split names made only of declared one-letter variables."""
    singles = {v for v in ctx.variables if len(v) == 1}
    out: list[tuple[str, str]] = []
    for kind, value in toks:
        if kind == "name" and len(value) > 1 and value not in FUNCTIONS and value not in CONSTANTS and value not in ctx.variables and set(value) <= singles:
            for j, ch in enumerate(value):
                if j:
                    out.append(("op", "*"))
                out.append(("name", ch))
        else:
            out.append((kind, value))
    return out


def _forbid_bare_log(toks: list[tuple[str, str]]) -> None:
    """log(x) without a base is ambiguous (SPEC.md §5)."""
    for i, (kind, value) in enumerate(toks):
        if kind == "name" and value == "log":
            depth, j = 0, i + 1
            has_comma = False
            while j < len(toks):
                v = toks[j][1]
                if v == "(":
                    depth += 1
                elif v == ")":
                    depth -= 1
                    if depth == 0:
                        break
                elif v == "," and depth == 1:
                    has_comma = True
                j += 1
            if not has_comma:
                raise ParseError("Write ln(x) for natural log, log10(x) for base 10, or log(x, base).")


def _make_globals() -> dict[str, object]:
    # parse_expr's generated code needs SymPy's number/symbol constructors; nothing else.
    g: dict[str, object] = {"__builtins__": {}}
    for name in ("Integer", "Float", "Rational", "Symbol", "Function", "Mul", "Add", "Pow", "Number"):
        g[name] = getattr(sp, name)
    return g


_GLOBALS = _make_globals()


def split_top_level(text: str, separators: re.Pattern[str]) -> list[str]:
    """Split on separators that are not inside brackets."""
    parts, depth, start, i = [], 0, 0, 0
    while i < len(text):
        ch = text[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0:
            m = separators.match(text, i)
            if m and m.end() > i:
                parts.append(text[start:i])
                start = i = m.end()
                continue
        i += 1
    parts.append(text[start:])
    return [p.strip() for p in parts if p.strip()]


def to_latex(expr: sp.Basic) -> str:
    try:
        return sp.latex(expr)
    except Exception:  # pragma: no cover - display only
        return str(expr)
