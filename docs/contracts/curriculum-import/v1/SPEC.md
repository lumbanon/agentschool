# Curriculum import contract — v1.0.0

**Contract id:** `agentschool.curriculum-import` · **Version:** 1.0.0 · **Status:** active
**Audience:** anyone preparing datasets for the AgentSchool backend (including Codex on `research/spm-curriculum`).
**Machine-readable rules:** [`schemas/`](schemas) (JSON Schema 2020-12) and [`validate.py`](validate.py). If this text and
the schemas disagree, the schemas win, and please report the mismatch.

## 1. Scope

v1 covers SPM **Additional Mathematics (3472)**, **Mathematics (1449)** and **Science (1511)**, **Forms 4 and 5**, structured as in
KSSM. It covers four kinds of data:

| Kind | What | Schema |
|---|---|---|
| `curriculum` | subject → form → chapter → content standard → learning standard | `curriculum.schema.json` |
| `lessons` | blackboard lessons linked to learning standards and exercises | `lessons.schema.json` |
| `exercises` | questions with machine-checkable answers | `exercises.schema.json` |
| `documents` | source documents for bulk ingestion (Markdown, text, PDF) | `documents.schema.json` |

## 2. Versioning

- Every data file and the manifest carry `"contract_version": "1.x.y"`.
- **Patch** (1.0.x): wording and clarifications only. Any 1.0.x file is valid under any other 1.0.x.
- **Minor** (1.x.0): additive and optional fields only. Older backends reject files that declare a newer minor than they
  support, with a clear "update the tooling" error. Write the lowest version that has the fields you use.
- **Major** (2.0.0): breaking. It lives in a new folder `curriculum-import/v2/`, and v1 stays readable.
- The dataset has its own semver in `manifest.dataset.version`, independent of the contract version.
- Every lesson, exercise and document has an integer `revision`. Change the content → bump the revision.
  The same id and revision with different content is an import error.

## 3. Bundle layout

A dataset is a directory (or a zip of one) with `manifest.json` at its root:

```
my-bundle/
  manifest.json              # lists every data file with its SHA-256
  curriculum/addmath.json    # one subject per curriculum file
  lessons/*.json
  exercises/*.json
  documents/documents.json   # metadata for document payloads
  documents/files/...        # payloads (.md, .txt, .pdf), hashed inside documents.json
```

Folder names are a convention. The manifest `kind` decides how each file is read. All JSON is UTF-8, and all text files
use **LF** line endings (hashes are over raw bytes; see the repo `.gitattributes`). After editing, run
`python validate.py my-bundle --update-hashes`.

A bundle may be partial, for example exercises only. References to items not in the bundle are warnings at validation
time. At import, the database must already contain them, or the import fails.

## 4. Text and TeX

- `localizedText` is `{ "en": "...", "ms": "..." }` with at least one language. Supply both where you can.
- Rich text is plain Markdown (paragraphs, `**bold**`, `*italic*`, lists) plus **inline TeX between single dollar signs**:
  `"Solve $2x^2 - 7x + 3 = 0$."`
  - No HTML.
  - No `$$`: put display maths in a `math` array instead.
  - A literal dollar sign is written `\$`.
- `math` arrays contain display TeX without dollar signs. It must render with **KaTeX 0.16 in strict mode** (no `\newcommand`).
- Remember JSON escaping: TeX `\times` is written `"\\times"` in JSON.

## 5. Math syntax (answers)

Used for every value the verifier reads (`expected`, `solutions`, `common_mistakes[].answer`).

| | Dataset files | Student input (also accepted) |
|---|---|---|
| Numbers | `-4`, `0.5`, `3/2` (no thousands separators) | `−4` (Unicode minus) |
| Operators | `+ - * / ^` (`**` also ok), brackets `( )` | implicit multiplication: `2x`, `3(x+1)`, `x(x-1)`; `×`, `÷` |
| Functions | `sqrt()`, `abs()`, `ln()`, `log10()`, `log(x, base)`, `exp()`, `sin()`, `cos()`, `tan()` | `√x`, `√(x+1)` |
| Constants | `pi`, `e` | `π` |
| Variables | one letter, optional subscript `x_1`. Not `e` (it is the constant) | |

- Write multiplication explicitly in dataset files: `2*x`, not `2x`.
- **Bare `log(x)` is forbidden** in datasets (ambiguous between base 10 and base e). The validator rejects it.
- Trigonometric functions take radians. Angle answers in degrees are plain numbers (`30`, `150`), with "in degrees"
  stated in the prompt.
- Values are exact where the maths is exact: write `1/3`, not `0.333`, and `sqrt(2)`, not `1.414`.

## 6. Identifiers

Lower-case kebab-case ASCII, unique across the whole dataset, never reused for different content.

| Item | Convention (validator-enforced for curriculum) | Example |
|---|---|---|
| subject | `addmath`, `math`, `science` | `addmath` |
| chapter | `<subject>-f<form>-c<NN>` | `addmath-f4-c02` |
| content standard | `<chapter>-cs-<code, dots→dashes>` | `addmath-f4-c02-cs-2-1` |
| learning standard | `<chapter>-ls-<code, dots→dashes>` | `addmath-f4-c02-ls-2-1-1` |
| lesson | `<chapter>-l<NN>` (recommended) | `addmath-f4-c02-l01` |
| exercise | `<chapter>-e<NNN>` (recommended) | `addmath-f4-c02-e001` |
| document | `doc-...` (recommended) | `doc-addmath-f4-c02-notes` |

Standard codes follow the DSKP: content standard `2.1`, learning standard `2.1.1`. A learning standard code must start
with its content standard code, and a content standard code with its chapter number.

## 7. Provenance, rights and review (honest-claims rules)

Every lesson, exercise and document has a `source` and a `review`.

**`source.kind`**
- `original`: written for AgentSchool.
- `adapted`: rewritten from a cited source. Needs `citation`.
- `quoted`: reproduced text. Needs `citation` and a `license` that allows it (not `unknown` or `all-rights-reserved`).
- `official_reference`: cites official codes or titles only, no copied prose. Needs `citation`.

**Copyright.** Do not copy textbook or past-paper text unless the licence allows it. For a copyrighted document you
can cite but not store, use `usage: "metadata_only"`: only its metadata is kept.

**AI-drafted content** must set `source.generated_with` (e.g. `"codex"`). It is still allowed, but it must be
human-reviewed before approval.

**`review.status`**: `draft` → `pending_review` → `approved` / `rejected`. `approved` and `rejected` need
`reviewed_by` and `reviewed_at`.
- **Only `approved` lessons and exercises are served to students.**
- **Importers do not trust `approved` from a file by default.** It is downgraded to `pending_review` unless the
  operator imports with `--trust-approvals`. Approvals are normally recorded in the backend by a named human reviewer.
  A dataset author should therefore submit `draft` or `pending_review`.

## 8. Answer types and how they are verified

The backend verifies with SymPy: it compares **meaning, not text**. Every answer must be checkable this way, or be
`manual`.

| `type` | Data | Correct when | Example student answers |
|---|---|---|---|
| `solution_set` | `variables`, `solutions: [{"x": "-4"}, {"x": "3"}]` (`[]` = no real solution) | exactly the same set of solutions, in any order | `x = -4 or x = 3` · `x=3, x=-4` · `-4, 3` · `x = -4 atau x = 3` |
| `expression` | `variables`, `expected`, `form`: `equivalent` / `factored` / `expanded` | mathematically equal **and**, for `factored`, a product of factors irreducible over ℚ, or for `expanded`, a sum of monomials | `(x-3)(x-2)` for factored; `x^2-5x+6` is *not* factored |
| `numeric` | `expected` (exact or decimal), optional `tolerance`, `decimal_places` **or** `significant_figures`, `unit` + `accepted_units` | within tolerance (default: exact), rounded as required, unit present and matching | `12.5 m s^-1` · `12.5 m/s` |
| `inequality` | `variable`, `expected` like `-2 < x < 3` or `x < -2 or x > 3` | the same set of real numbers | `-2<x<3` · `x > -2 and x < 3` |
| `equation` | `variables`, `expected` like `y = 2*x + 3` | the same solution set (any rearrangement or non-zero multiple) | `2x - y + 3 = 0` |
| `multiple_choice` | `options` (A–F), `correct` | the chosen set equals `correct` | `B` |
| `manual` | `rubric` | never auto-verified: recorded and shown as "not verified" | — |

- **`common_mistakes`**: wrong answers with targeted feedback. The importer checks that each one does *not* verify as correct.
- The importer also checks that `expected` and `solutions` parse and are self-consistent. A dataset whose answers the
  verifier cannot read is rejected.

## 9. Documents (bulk ingestion)

- **Media types:** `text/markdown` (`.md`), `text/plain` (`.txt`), `application/pdf` (`.pdf`, text-based; scanned
  PDFs are not OCR'd in v1).
- **Payloads** are listed in a `documents` file with their own `sha256`.
- **`usage: full_text`:** the text is extracted, split into chunks, and stored for search and retrieval. It needs
  `source.kind: original` or a licence that allows storage.
- **`usage: metadata_only`:** only the metadata row is stored.
- **Tags:** `subject` is required, and `form` + `learning_standards` are optional, so retrieval can be scoped.
- **Limits:** a payload may be at most 20 MB, and a documents file may list at most 5000 documents.

## 10. Validation and import behaviour

```
pip install "jsonschema>=4.18"
python docs/contracts/curriculum-import/v1/validate.py path/to/bundle          # exit 0 = valid
python docs/contracts/curriculum-import/v1/validate.py path/to/bundle --json   # for CI
```

**The validator checks:**
- schemas
- SHA-256s and contract version
- duplicate ids
- id and code conventions
- that standards, exercises and chapters referenced inside the bundle exist and belong to the same subject and form
- answer syntax: allowed characters and no bare `log`
- payload files exist with matching extensions

**The backend importer** (`agentschool import <bundle> [--dry-run]`) runs the same validator, then:
- checks references against the database
- runs the SymPy self-checks (§8)
- applies the review policy (§7)
- imports **in one transaction**: the whole bundle or nothing

**Import is idempotent:**
- same id, revision and content: skipped
- higher revision: updated, and older revisions are kept for history
- lower revision, or same revision with different content: error

## 11. Checklist for dataset authors

- [ ] `python validate.py <bundle>` prints `OK` with no errors. Warnings are only for references you know already exist.
- [ ] Curriculum codes and titles are checked against the official DSKP. The sample bundle's codes are placeholders.
- [ ] Every item has an honest `source`, with `generated_with` set if an AI drafted it.
- [ ] No copyrighted text is stored without permission. Use `metadata_only` documents instead.
- [ ] Every non-manual answer is exact and in the §5 syntax, and each `common_mistakes` entry is genuinely wrong.
- [ ] New and changed items are `draft` or `pending_review`, and revisions are bumped for changed content.
