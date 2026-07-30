# Acceptance commands

Run from the repository root with Node.js 20 or newer.

## One-command release gate

```sh
node scripts/verify.mjs
```

Expected final line:

```text
SaveWeaver release gate passed.
```

The command must finish with exit code 0 and performs every section below.

## Focused commands

```sh
node scripts/static-check.mjs
node scripts/format-check.mjs
node --test
node --test --experimental-test-coverage \
  --test-coverage-lines=90 \
  --test-coverage-functions=90 \
  --test-coverage-branches=80
node bin/saveweaver.js lock --project examples/space-ranger --check
node bin/saveweaver.js matrix --project examples/space-ranger
node scripts/package-release.mjs
node scripts/verify-release.mjs
```

Windows PowerShell can place the coverage command on one line.

## Behavioral acceptance

Preview without writing:

```sh
node bin/saveweaver.js migrate \
  examples/space-ranger/fixtures/v1/veteran.json \
  --project examples/space-ranger \
  --dry-run
```

Expected: the two-step plan, a structural diff, and the sentence
`Dry run: no files were written.`

Write and verify in a temporary directory:

```sh
node bin/saveweaver.js migrate \
  examples/space-ranger/fixtures/v1/veteran.json \
  --project examples/space-ranger \
  --out migrated-veteran.json
node bin/saveweaver.js verify-receipt \
  migrated-veteran.json.saveweaver-receipt.json \
  migrated-veteran.json
```

Expected: output save version 3 and a matching receipt hash. Remove the two
temporary files after inspection.

## Release artifacts

`artifacts/` must contain:

- `saveweaver-v0.1.0.tgz`;
- `saveweaver-v0.1.0-portable.zip`;
- `checksums.sha256`;
- `release-manifest.json`.

`verify-release.mjs` checks the manifest hashes and sizes, every stored ZIP
entry CRC, an npm install into a fresh temporary directory, the installed
version, and a compatibility matrix run through the installed CLI.

## Publication acceptance

A local green gate is not a public release. Before calling v0.1.0 released,
verify:

```sh
gh auth status
git status --short
git shortlog -sne HEAD
gh repo view KanadeK/saveweaver --json visibility,url,defaultBranchRef
gh run list --repo KanadeK/saveweaver --limit 20
gh release view v0.1.0 --repo KanadeK/saveweaver
```

The repository must be public, all required workflows green, the tag must point
to the intended commit, downloaded asset hashes must equal
`checksums.sha256`, and contributor history must contain only intended authors.
