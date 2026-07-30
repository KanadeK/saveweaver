# Changelog

All notable changes follow semantic versioning.

## [0.1.1] - 2026-07-30

### Fixed

- Canonicalized npm tar entries, executable modes, timestamps, ordering, and
  gzip bytes so Windows and Linux builds have identical SHA-256 values.
- Normalized the portable Windows launcher before ZIP assembly.
- Allowed intentional CRLF launchers without weakening format checks for other
  files, with regression coverage for mixed and malformed line endings.
- Updated GitHub Actions to their Node 24 generations and made Release asset
  uploads safe to rerun with `--clobber`.

## [0.1.0] - 2026-07-30

### Added

- Declarative, engine-agnostic JSON save migrations with ten operation types.
- Focused JSON Schema 2020-12 validation with explicit unsupported-keyword
  errors.
- Unambiguous migration graph planning and schema compatibility diffing.
- Fixture matrix with source/intermediate/target validation, determinism, and
  idempotency checks.
- SHA-256 contract locks and migration receipts.
- Safe dry-run, separate-output, and backed-up atomic in-place workflows.
- Zero-dependency CLI, JavaScript API, and Node 24 GitHub Action.
- Three-version Space Ranger example with four historical/current fixtures.
- Cross-platform CI, security checks, deterministic packages, checksums, and a
  clean-install release gate.

[0.1.1]: https://github.com/KanadeK/saveweaver/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/KanadeK/saveweaver/releases/tag/v0.1.0
