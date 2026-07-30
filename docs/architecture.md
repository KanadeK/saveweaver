# Architecture

SaveWeaver keeps the mutation core independent from files, CLI parsing, and CI.
The design makes migration behavior directly testable and prevents a failed
operation from partially changing the caller's object.

```text
saveweaver.json + schemas + migrations + fixtures
                         │
                         ▼
                 project loader
        path confinement · schema support · graph checks
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       migration planner       contract lock
              │                     │
              ▼                     │
       pure operation engine        │
       clone · apply · record       │
              │                     │
              ▼                     │
       versioned validation ◄───────┘
              │
        ┌─────┴────────┐
        ▼              ▼
  compatibility     safe writer
     matrix       backup · atomic rename
        │              │
        ▼              ▼
  CI/Action report  SHA-256 receipt
```

## Modules

| Module | Responsibility |
| --- | --- |
| `src/project.js` | Confine paths to the project, load contracts, reject unsupported schema keywords, and validate the graph |
| `src/graph.js` | Prove one unambiguous forward path and plan a requested migration |
| `src/operations.js` | Validate and apply declarative operations to a cloned document |
| `src/schema.js` | Offline validation for the documented JSON Schema subset |
| `src/engine.js` | Validate source, run each migration, set the version, and validate every target |
| `src/matrix.js` | Run real fixtures twice for determinism and once more for idempotency |
| `src/lock.js` | Detect changed configuration, schemas, or migration history by SHA-256 |
| `src/receipt.js` | Create and verify deterministic migration evidence |
| `src/cli.js` | Enforce safe command defaults and machine-readable output |

## Trust boundaries

Configuration paths are untrusted input. Absolute paths and paths that resolve
outside the project root are rejected. Migration files are data; they cannot
execute JavaScript, shell commands, network requests, or environment-variable
expansions.

Save files are also untrusted. The validator and operation engine use only own
properties and JSON-compatible values. Output writes are opt-in, use a
same-directory temporary file, and are renamed only after the complete
migration and target validation pass.

## Determinism

Receipts and lock files omit timestamps. JSON hashing recursively sorts object
keys. The compatibility matrix runs each fixture migration twice and compares
output hashes. The npm tarball is rebuilt with sorted ustar entries, normalized
permissions, a fixed timestamp, and a platform-neutral stored gzip stream.
Release ZIP entries are sorted, stored with fixed DOS timestamps, and verified
by CRC-32. Release manifests contain sizes and SHA-256 values but no build time.

## Extension strategy

New operations should be:

1. representable as JSON;
2. deterministic and offline;
3. validated before execution;
4. applied only to the cloned document;
5. recorded as explicit field changes;
6. covered for success, missing-path behavior, type failure, and rollback.

Engine-specific binary decoders belong outside this core. An adapter can decode
to JSON, call `migrateDocument`, and encode only after success.
