# Opportunity and competitor scan

Snapshot date: 2026-07-30.

The goal was a game-related open-source project with broad discovery potential
that did not repeat the existing workspace's game-feel lab, deterministic
replay/desync tools, promotional capture reviewer, shader notebook, Git
learning game, or repository guessing game.

## Signals

| Adjacent project | Public signal | What it proves | Gap left open |
| --- | ---: | --- | --- |
| [Ludusavi](https://github.com/mtkennerly/ludusavi) | About 6.0k stars | Cross-platform game-save safety has a broad player audience | It locates, backs up, and restores saves; it does not own a game's internal version migration contract |
| [ink](https://github.com/inkle/ink) | About 4.9k stars | Engine-usable game-development infrastructure can attract a durable community | Narrative authoring is already a mature category |
| [Yarn Spinner](https://github.com/YarnSpinnerTool/YarnSpinner) | About 2.8k stars | Friendly, engine-agnostic game tooling has multi-game reach | Dialogue systems are already crowded and would duplicate a strong ecosystem |
| [schema-validator-action](https://github.com/cardinalby/schema-validator-action) | About 18 stars in its Marketplace listing | Teams want schema checks in CI | A one-version validator does not execute or audit historical game-save migrations |
| [loot-table-advanced](https://github.com/NimaiMalle/loot-table-advanced) | About 3 stars | Generic nested loot modeling exists | The sampled library has little discovery, while single-game gacha simulators fragment the audience |

GitHub issues and save converters also repeatedly show that copied or backed-up
files can still fail because their internal format changed. That distinction is
explicit in the [GPSaveConverter compatibility
notes](https://github.com/Fr33dan/GPSaveConverter/wiki/Game-Compatibility):
moving the right file cannot repair an incompatible save format.

## Candidates considered

### Game-save compatibility CI — selected

Broad audience across engines, costly failure mode, easy to demonstrate with
real data, and a clear boundary from player-side backup tools. The shareable
artifact is a compatibility matrix that can live in a pull request or release.

### Narrative soft-lock graph validator — rejected

Potentially useful, but parsers and semantics would immediately compete with
Ink and Yarn Spinner. A shallow universal parser would be less credible than
their native compilers; a deep integration would narrow the audience.

### Loot and pity probability auditor — rejected

Interesting math, but the ecosystem is divided between single-game simulators
and engine-specific loot libraries. It also risks looking like another
calculator unless it implements a large state-machine surface.

## Product hypothesis

The concise promise is: **“CI for the save files your players already have.”**

Discovery hooks:

- `gamedev`, `game-save`, `migration`, `json-schema`, and `github-action`
  topics connect multiple developer communities;
- a zero-dependency CLI lowers trial cost;
- a three-version runnable example demonstrates value in one command;
- the GitHub Action produces a visible compatibility matrix;
- deterministic receipts, contract locks, and safe in-place behavior make the
  project usable in release pipelines rather than only as a demo.

Stars and traffic cannot be guaranteed. The implementation maximizes the chance
by solving a broad release risk with inspectable behavior, not by predicting a
number or shipping a visual shell.
