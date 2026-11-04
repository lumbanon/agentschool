# AgentSchool data contracts

Versioned contracts between people or tools that **produce** data and the backend that **consumes** it.

| Contract | Current | Spec | For |
|---|---|---|---|
| `agentschool.curriculum-import` | **v1.0.0** | [curriculum-import/v1/SPEC.md](curriculum-import/v1/SPEC.md) | curriculum structure, lessons, exercises with verifiable answers, source documents |

## Quick start (dataset authors)

```bash
pip install "jsonschema>=4.18"
python docs/contracts/curriculum-import/v1/validate.py docs/contracts/curriculum-import/v1/examples/sample-bundle
# OK: 0 error(s), 0 warning(s); ...
```

Start from [`examples/sample-bundle`](curriculum-import/v1/examples/sample-bundle). It contains one of every file kind
and every answer type. Its curriculum codes are placeholders: check real ones against the DSKP.

## Rules for changing a contract

- Contracts change only through a reviewed commit that bumps the version and adds a [CHANGELOG](CHANGELOG.md) entry.
- Patch and minor changes edit `v1/` in place. A breaking change creates `v2/` alongside it.
- The JSON Schemas are the source of truth. `SPEC.md` explains them, and `validate.py` adds the cross-file checks that
  JSON Schema can't express.
- Contract files keep LF line endings (see `.gitattributes`), because bundle files are hashed byte for byte.
