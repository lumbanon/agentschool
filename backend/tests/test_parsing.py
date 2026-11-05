"""Safe parser: whitelist, limits, Unicode and student-friendly syntax."""
import re

import pytest
import sympy as sp

from agentschool_api.verification.parsing import Context, ParseError, parse_math

X = Context(("x",))
XY = Context(("x", "y"))
x, y = sp.Symbol("x", real=True), sp.Symbol("y", real=True)


@pytest.mark.parametrize(
    "text, expected",
    [
        ("2x + 1", 2 * x + 1),
        ("3(x+1)", 3 * x + 3),
        ("x(x-1)", x**2 - x),
        ("x^2", x**2),
        ("x**2", x**2),
        ("−4", sp.Integer(-4)),  # Unicode minus
        ("2×3", sp.Integer(6)),
        ("6÷4", sp.Rational(3, 2)),
        ("√9", sp.Integer(3)),
        ("√(x+1)", sp.sqrt(x + 1)),
        ("π", sp.pi),
        ("ln(e)", sp.Integer(1)),
        ("log10(100)", sp.Integer(2)),
        ("log(8, 2)", sp.Integer(3)),
        ("x²", x**2),
        ("0.5", sp.Float(0.5)),
    ],
)
def test_reads_student_maths(text, expected):
    assert sp.simplify(parse_math(text, X) - expected) == 0


def test_two_letter_products_split_into_declared_variables():
    assert parse_math("2xy", XY) == 2 * x * y


@pytest.mark.parametrize(
    "text, message",
    [
        ("__import__('os')", "Unexpected character"),
        ("x.real", "Unexpected character"),
        ("lambda: 1", "Unexpected character"),
        ("open(x)", "Unknown name 'open'"),
        ("eval(x)", "Unknown name 'eval'"),
        ("z + 1", "Unknown name 'z'"),
        ("sqrt x", "needs brackets"),
        ("log(x)", "log10(x) for base 10"),
        ("9^9^9", "too complicated"),
        ("2^1000", "too large"),
        ("1" * 40, "too long"),
        ("(" * 31 + "x" + ")" * 31, "nested"),
        ("(x+1", "Unbalanced"),
        ("x+1)", "Unbalanced"),
        ("", "empty"),
        ("x" * 301, "too long"),
        ("x = 2", "single expression"),
        ("x < 2", "single expression"),
    ],
)
def test_rejects_unsafe_or_unreadable_input(text, message):
    with pytest.raises(ParseError, match=re.escape(message)):
        parse_math(text, X)


def test_rejection_messages_are_safe_to_show():
    with pytest.raises(ParseError) as err:
        parse_math("__import__('os').system('rm -rf /')", X)
    assert "Traceback" not in str(err.value)
