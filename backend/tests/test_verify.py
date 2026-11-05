"""Answer verification for every answer type in the import contract (SPEC.md §8)."""
import json

import pytest

from agentschool_api.importer.importer import self_check_exercise
from agentschool_api.verification.verify import (
    CORRECT,
    INCORRECT,
    INVALID,
    NOT_VERIFIABLE,
    SpecError,
    canonical_answer_text,
    verify,
)
from conftest import PILOT_BUNDLE, SAMPLE_BUNDLE

QUADRATIC = {"type": "solution_set", "variables": ["x"], "solutions": [{"x": "-4"}, {"x": "3"}]}
MISTAKES = [{"answer": "x = 4 or x = -3", "feedback": {"en": "Check the signs."}}]


@pytest.mark.parametrize(
    "answer, status",
    [
        ("x = -4 or x = 3", CORRECT),
        ("x=3, x=-4", CORRECT),
        ("-4, 3", CORRECT),
        ("x = -4 atau x = 3", CORRECT),
        ("x = −4 or x = 3", CORRECT),
        ("x = 12/3 - 8 or x = 3", CORRECT),
        ("x = -4 or x = 3 or x = 3", CORRECT),  # repeated root listed twice
        ("x = 3", INCORRECT),
        ("x = -4 or x = 3 or x = 5", INCORRECT),
        ("x = 4 or x = -3", INCORRECT),
        ("y = -4 or y = 3", INVALID),
        ("banana", INVALID),
    ],
)
def test_solution_set(answer, status):
    assert verify(QUADRATIC, answer, MISTAKES).status == status


def test_solution_set_feedback():
    assert verify(QUADRATIC, "x = 4 or x = -3", MISTAKES).mistake_feedback == {"en": "Check the signs."}
    assert "more solutions" in verify(QUADRATIC, "x = 3").message
    assert "not a solution" in verify(QUADRATIC, "x = -4, x = 3, x = 1").message


def test_solution_set_exact_values_and_no_solution():
    surd = {"type": "solution_set", "variables": ["x"], "solutions": [{"x": "1 + sqrt(2)"}, {"x": "1 - sqrt(2)"}]}
    assert verify(surd, "x = 1 - √2 or x = 1 + √2").status == CORRECT
    assert verify(surd, "x = 2.414 or x = -0.414").status == INCORRECT  # decimals are not exact
    none = {"type": "solution_set", "variables": ["x"], "solutions": []}
    for phrase in ("no real solution", "tiada penyelesaian", "{}"):
        assert verify(none, phrase).status == CORRECT
    assert verify(none, "x = 0").status == INCORRECT


def test_solution_set_for_a_system():
    system = {"type": "solution_set", "variables": ["x", "y"], "solutions": [{"x": "2", "y": "3"}, {"x": "-1", "y": "0"}]}
    assert verify(system, "x = 2, y = 3 or x = -1, y = 0").status == CORRECT
    assert verify(system, "(-1, 0) or (2, 3)").status == CORRECT
    assert verify(system, "x = 2 and y = 3").status == INCORRECT  # one solution missing
    assert verify(system, "(2, 3, 4)").status == INVALID


FACTOR = {"type": "expression", "variables": ["x"], "expected": "(x - 2)*(x - 3)", "form": "factored"}


@pytest.mark.parametrize(
    "answer, status",
    [
        ("(x-2)(x-3)", CORRECT),
        ("(x-3)(x-2)", CORRECT),
        ("(2x-4)(x-3)/2", CORRECT),
        ("(x-2)*(x-3)", CORRECT),
        ("x^2-5x+6", INCORRECT),  # equal but not factored
        ("x(x-5)+6", INCORRECT),
        ("(x-1)(x-6)", INCORRECT),
    ],
)
def test_expression_factored(answer, status):
    assert verify(FACTOR, answer).status == status


def test_expression_equal_but_wrong_form_explains_why():
    assert "not fully factorised" in verify(FACTOR, "x^2 - 5x + 6").message
    expanded = {"type": "expression", "variables": ["x"], "expected": "x^2 - 1", "form": "expanded"}
    assert verify(expanded, "x^2 - 1").status == CORRECT
    assert "not expanded" in verify(expanded, "(x-1)(x+1)").message
    equivalent = {"type": "expression", "variables": ["x"], "expected": "(x+1)^2", "form": "equivalent"}
    assert verify(equivalent, "x^2 + 2x + 1").status == CORRECT
    repeated = {"type": "expression", "variables": ["x"], "expected": "(x - 2)^2", "form": "factored"}
    assert verify(repeated, "(x-2)^2").status == CORRECT
    assert verify(repeated, "(x-2)(x-2)").status == CORRECT


SPEED = {"type": "numeric", "expected": "150/12", "tolerance": {"absolute": 0.05}, "unit": "m s^-1", "accepted_units": ["m/s", "ms^-1"]}


@pytest.mark.parametrize(
    "answer, status, says",
    [
        ("12.5 m s^-1", CORRECT, "Correct"),
        ("12.5 m/s", CORRECT, "Correct"),
        ("12.5 ms^-1", CORRECT, "Correct"),
        ("12.5 m s^(-1)", CORRECT, "Correct"),
        ("12.49 m/s", CORRECT, "Correct"),
        ("12.6 m/s", INCORRECT, "Not quite"),
        ("12.5", INCORRECT, "Include the unit"),
        ("12.5 km/h", INCORRECT, "Check the unit"),
    ],
)
def test_numeric_with_units(answer, status, says):
    v = verify(SPEED, answer)
    assert (v.status, says in v.message) == (status, True)


def test_numeric_rounding_rules():
    dp = {"type": "numeric", "expected": "pi", "decimal_places": 2}
    assert verify(dp, "3.14").status == CORRECT
    assert "2 decimal places" in verify(dp, "3.142").message
    assert verify(dp, "3.15").status == INCORRECT
    sf = {"type": "numeric", "expected": "2/3", "significant_figures": 3}
    assert verify(sf, "0.667").status == CORRECT
    assert "3 significant figures" in verify(sf, "0.67").message
    exact = {"type": "numeric", "expected": "1/3"}
    assert verify(exact, "1/3").status == CORRECT
    assert verify(exact, "0.333").status == INCORRECT  # no tolerance means exact
    rel = {"type": "numeric", "expected": "1000", "tolerance": {"relative": 0.01}}
    assert verify(rel, "1009").status == CORRECT
    assert verify(rel, "1011").status == INCORRECT
    assert verify({"type": "numeric", "expected": "5"}, "5 m").status == INVALID  # unit where none is expected


INEQ = {"type": "inequality", "variable": "x", "expected": "-2 < x < 3"}


@pytest.mark.parametrize(
    "answer, status",
    [
        ("-2 < x < 3", CORRECT),
        ("x > -2 and x < 3", CORRECT),
        ("3 > x > -2", CORRECT),
        ("x < 3 dan x > -2", CORRECT),
        ("-2 ≤ x ≤ 3", INCORRECT),
        ("x < -2 or x > 3", INCORRECT),
        ("-2 < 3", INVALID),
        ("x", INVALID),
    ],
)
def test_inequality(answer, status):
    assert verify(INEQ, answer).status == status


def test_inequality_union():
    outside = {"type": "inequality", "variable": "x", "expected": "x < -2 or x > 3"}
    assert verify(outside, "x > 3 or x < -2").status == CORRECT
    assert verify(outside, "x > 3 atau x < -2").status == CORRECT
    assert verify(outside, "x >= 3 or x < -2").status == INCORRECT


def test_equation_same_solution_set():
    line = {"type": "equation", "variables": ["x", "y"], "expected": "y = 2*x + 3"}
    for ok in ("y = 2x + 3", "2x - y + 3 = 0", "2y = 4x + 6", "y - 3 = 2x"):
        assert verify(line, ok).status == CORRECT, ok
    assert verify(line, "y = 2x - 3").status == INCORRECT
    assert verify(line, "y == 2x").status == INVALID


def test_multiple_choice_and_manual():
    mcq = {"type": "multiple_choice", "options": [{"id": k, "text": {"en": k}} for k in "ABCD"], "correct": ["B", "D"]}
    assert verify(mcq, "B, D").status == CORRECT
    assert verify(mcq, "d b").status == CORRECT
    assert verify(mcq, "B").status == INCORRECT
    assert verify(mcq, "Z").status == INVALID
    manual = {"type": "manual", "rubric": [{"en": "Explains."}]}
    v = verify(manual, "Because the speedometer...")
    assert (v.status, v.correct) == (NOT_VERIFIABLE, None)


def test_broken_answer_specs_raise_spec_error():
    with pytest.raises(SpecError):
        verify({"type": "solution_set", "variables": ["x"], "solutions": [{"x": "log(2)"}]}, "x = 1")
    with pytest.raises(SpecError):
        verify({"type": "telepathy"}, "x")


def test_verdict_serialises_with_verifier_version():
    d = verify(QUADRATIC, "x = -4 or x = 3").to_dict()
    assert d["correct"] is True and d["verifier"].startswith("agentschool-verifier/1.0 sympy/")


@pytest.mark.parametrize("bundle", [SAMPLE_BUNDLE, PILOT_BUNDLE], ids=["sample", "pilot"])
def test_every_shipped_exercise_passes_its_self_check(bundle):
    for f in sorted((bundle / "exercises").glob("*.json")):
        for ex in json.loads(f.read_text(encoding="utf-8"))["exercises"]:
            assert self_check_exercise(ex) == [], ex["id"]
            if ex["answer"]["type"] != "manual":
                assert verify(ex["answer"], canonical_answer_text(ex["answer"])).status == CORRECT


def test_self_check_catches_bad_data():
    good = json.loads((SAMPLE_BUNDLE / "exercises" / "addmath-f4-c02.json").read_text(encoding="utf-8"))["exercises"][0]
    wrong_expected = {**good, "answer": {**good["answer"], "solutions": [{"x": "-4"}, {"x": "3"}, {"x": "sqrt(-1)"}]}}
    assert self_check_exercise(wrong_expected)
    correct_mistake = {**good, "common_mistakes": [{"answer": "x = 3 or x = -4", "feedback": {"en": "?"}}]}
    assert "verifies as CORRECT" in self_check_exercise(correct_mistake)[0]
    unreadable_mistake = {**good, "common_mistakes": [{"answer": "x equals four", "feedback": {"en": "?"}}]}
    assert "cannot be read" in self_check_exercise(unreadable_mistake)[0]
