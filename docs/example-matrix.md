# SaveWeaver compatibility matrix: space-ranger

Current save version: **v3**

| Fixture | Source | Target | Migration chain | Result |
| --- | ---: | ---: | --- | --- |
| `fixtures/v1/fresh-cadet.json` | v1 | v3 | `001-player-progression` → `002-profile-wallet` | PASS |
| `fixtures/v1/veteran.json` | v1 | v3 | `001-player-progression` → `002-profile-wallet` | PASS |
| `fixtures/v2/shipyard.json` | v2 | v3 | `002-profile-wallet` | PASS |
| `fixtures/v3/current.json` | v3 | v3 | already current | PASS |

**4/4 passed; 0 failed.**

Each passing row was schema-validated before and after migration, migrated twice to prove deterministic output, and migrated once more to prove current-version idempotency.
