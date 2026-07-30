# Repair playbook

Start with the narrowest failing command. Do not rewrite a lock or migration
just to make a red check green; first decide whether the change is intended.

## `INVALID_CONFIG`

Run:

```sh
node bin/saveweaver.js check --project path/to/save-contract --format json
```

Check that `format` is 1, `current_version` is an integer, `version_pointer` is
a non-root JSON Pointer, paths are relative, the current schema exists, and
fixture directories contain JSON files.

## `PATH_OUTSIDE_PROJECT`

Move the referenced schema, migration, fixture directory, or lock inside the
contract directory and use a relative path. SaveWeaver intentionally does not
offer an override.

## `UNSUPPORTED_SCHEMA`

The JSON error includes the exact schema path and keyword. Replace the keyword
with the documented subset, or validate that concern in an additional external
CI step. Do not assume an unsupported keyword was enforced.

## `INVALID_MIGRATION_GRAPH`

Each historical schema version needs exactly one forward path to
`current_version`.

```sh
node bin/saveweaver.js plan \
  fixtures/oldest-supported.json \
  --project path/to/save-contract
```

Add the missing migration, remove an accidental competing edge, or add the
missing intermediate schema. Format 1 does not support downgrade edges.

## `SCHEMA_VALIDATION_FAILED`

The JSON error contains every failing pointer and keyword.

- Source failure: the fixture is corrupt, the source schema is wrong, or the
  fixture is labeled with the wrong version.
- Intermediate failure: the migration producing that version is incomplete.
- Target failure: add or correct operations; do not weaken the schema unless
  the target game genuinely accepts the data.

Re-run the one fixture through `plan` or `migrate --dry-run`, then run the whole
matrix.

## `MIGRATION_FAILED`

Read the migration id, operation index, cause code, and pointer. Common repairs:

| Cause | Repair |
| --- | --- |
| `POINTER_NOT_FOUND` | Correct the path, add a source assertion, or use `if_missing: "ignore"` only when absence is valid |
| `DESTINATION_EXISTS` | Remove the competing operation or explicitly set `overwrite: true` after checking data-loss semantics |
| `TYPE_MISMATCH` | Add a prior mapping or assertion; do not coerce silently |
| `UNMAPPED_VALUE` | Add an explicit case or document why `if_unmapped: "keep"` is safe |
| `ASSERTION_FAILED` | Fix the source assumption or split the migration path |

The source object and source file are unchanged after any failure.

## Contract lock failure

Inspect the listed files:

```sh
git diff -- saveweaver.json schemas migrations
```

If an already-released migration changed accidentally, restore it and create a
new forward migration. If every change is intentional and reviewed, regenerate:

```sh
node bin/saveweaver.js lock --project path/to/save-contract
node bin/saveweaver.js check --project path/to/save-contract
```

Commit the contract change and lock together.

## Nondeterministic or non-idempotent matrix failure

SaveWeaver operations are deterministic, so this usually indicates an adapter
or programmatic API extension added time, randomness, unordered external data,
or a version field that did not reach `current_version`. Remove external state,
sort inputs before migration, and ensure the final version pointer is correct.

## Package gate failure

```sh
node scripts/package-release.mjs
node scripts/verify-release.mjs
```

- `npm-cli.js was not found`: install npm next to Node.js or invoke the package
  script through npm.
- clean install failure: inspect `npm pack --json`; confirm every runtime file
  is in `package.json` `files`.
- ZIP CRC failure: do not publish the ZIP; rerun packaging from a clean
  checkout and inspect changes to `scripts/lib/zip.mjs`.
- hash mismatch: delete only the repository's resolved `artifacts/` directory
  and rebuild. Never edit `checksums.sha256` by hand.

## GitHub publication failure

```sh
gh auth status
```

If the active token is invalid:

```sh
gh auth login -h github.com
gh auth status
```

Then retry only the failed remote step. Do not recreate a local repository,
move a public tag, or claim a release from local artifacts alone.

If Git Smart HTTP has a TLS handshake problem, retry the specific push with:

```sh
git -c http.version=HTTP/1.1 push --set-upstream origin main
```

After any retry, re-check CI, tag target, Release assets, downloaded hashes,
visibility, author history, and contributors.
