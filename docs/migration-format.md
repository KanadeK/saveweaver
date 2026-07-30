# Migration and schema format

## Project configuration

`saveweaver.json` is format version 1.

| Field | Meaning |
| --- | --- |
| `format` | Must be `1` |
| `name` | Stable project identifier |
| `current_version` | Latest non-negative integer save version |
| `version_pointer` | Non-root JSON Pointer containing the integer version |
| `schemas` | Version-to-relative-schema-path map |
| `migrations` | Ordered list of relative migration paths |
| `fixture_dirs` | Directories recursively scanned for `.json` saves |
| `lock_file` | Contract lock path; defaults to `.saveweaver.lock.json` |
| `policy.require_all_schemas` | Require a schema at each visited version; defaults to `true` |

All paths must remain inside the project root. Each schema version below the
current version must have exactly one forward migration path to the current
version.

## Migration envelope

```json
{
  "id": "003-inventory-stacks",
  "from": 3,
  "to": 4,
  "description": "Rename stack size and cap imported quantities.",
  "operations": []
}
```

`id` uses lowercase letters, numbers, dots, underscores, or hyphens. `to` must
be greater than `from`. Downgrades are intentionally unsupported in format 1.

Operations use JSON Pointer paths. A missing path fails unless that operation
documents `if_missing: "ignore"`. Destinations do not overwrite by default for
`copy`, `move`, and `rename`.

## Operations

### `assert`

Stop before mutation assumptions become data loss:

```json
{
  "op": "assert",
  "path": "/inventory",
  "exists": true,
  "type": "array"
}
```

Predicates are `exists`, `type`, `equals`, and `one_of`. Multiple predicates
must all pass.

### `copy`, `move`, and `rename`

```json
{
  "op": "move",
  "from": "/player/credits",
  "to": "/wallet/credits",
  "create_parents": true
}
```

`rename` and `move` have identical data behavior; the distinct operation name
makes intent visible in receipts. Options are `create_parents`, `overwrite`,
and `if_missing`.

### `set` and `set_default`

```json
{
  "op": "set_default",
  "path": "/wallet/tokens",
  "value": 0,
  "create_parents": true
}
```

`set` writes the value. `set_default` writes only when the target is absent.
Values are deep-cloned.

### `delete`

```json
{
  "op": "delete",
  "path": "/legacy_checksum",
  "if_missing": "ignore"
}
```

### `map_value`

```json
{
  "op": "map_value",
  "path": "/difficulty",
  "cases": [
    { "from": "normal", "to": "standard" },
    { "from": "hard", "to": "veteran" }
  ]
}
```

Matching uses exact canonical JSON equality. An unmapped value fails unless
`if_unmapped` is `"keep"`.

### `number`

```json
{
  "op": "number",
  "path": "/stats/experience",
  "multiply": 1.2,
  "add": 5,
  "min": 0,
  "max": 999999,
  "round": "floor"
}
```

Modifiers apply in this order: multiply, add, minimum clamp, maximum clamp,
round. Round modes are `floor`, `ceil`, `nearest`, and `none`. Non-finite input
or output fails.

### `for_each`

```json
{
  "op": "for_each",
  "path": "/inventory",
  "operations": [
    {
      "op": "rename",
      "from": "/qty",
      "to": "/quantity"
    }
  ]
}
```

The target may be an array or object. Nested operation paths are relative to
each member. Nesting `for_each` is supported.

## Failure behavior

The engine clones the entire source document before the first operation. If an
assertion, pointer, type, mapping, number, or target-schema check fails, the
source object and source file remain unchanged. `--in-place` does not write its
backup or output until the complete in-memory migration passes.

A separate `--out` path is also non-destructive by default: an existing file
produces `OUTPUT_EXISTS` unless `--overwrite` is explicit.

## Schema support

Format 1 supports:

- `$schema`, `$id`, `$defs`, local `$ref`, and annotation keywords;
- `type`, `required`, `properties`, `additionalProperties`, `items`;
- `const`, `enum`, `allOf`, `anyOf`, `oneOf`, `not`;
- `minimum`, `maximum`, exclusive bounds, and `multipleOf`;
- string length and `pattern`;
- array length and `uniqueItems`;
- object property-count bounds.

Schemas may also be boolean. Remote references and unsupported keywords fail
project loading; they are never ignored.
