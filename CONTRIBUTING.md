# Contributing

Contributions are welcome when they preserve deterministic, offline,
data-only migration behavior.

## Setup

Requirements: Node.js 20 or newer.

```sh
git clone https://github.com/KanadeK/saveweaver.git
cd saveweaver
node "path/to/npm-cli.js" install
node scripts/verify.mjs
```

## Change requirements

- Add tests for success and failure semantics.
- Keep runtime dependencies at zero unless the benefit and supply-chain cost
  are demonstrated.
- Do not make unsupported schema keywords silently pass.
- Do not add operations that execute code, shell commands, or network calls.
- Preserve source immutability on every failure.
- Update format documentation and the Space Ranger example when behavior is
  user-visible.
- Regenerate a contract lock only for intentional contract changes.

## Pull requests

Explain the player or release risk addressed, the data behavior before and
after, failure behavior, and the exact verification commands. Include a
fixture when the change concerns compatibility.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
