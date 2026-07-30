# Security policy

## Supported versions

Security fixes are provided for the latest released minor version.

## Reporting

Please use GitHub's private vulnerability reporting for this repository. Do
not attach real player saves, credentials, encryption keys, or proprietary game
data to a public issue. A minimal synthetic save and migration are preferred.

## Security model

SaveWeaver:

- performs no network requests;
- runs no code from migration files;
- rejects project paths outside the configured root;
- treats unsupported schema keywords as errors;
- clones source data before migration;
- requires an explicit output mode;
- backs up before an in-place write;
- uses atomic replacement after full target validation;
- records SHA-256 contract locks and migration receipts.

SaveWeaver is not a sandbox for arbitrary JavaScript adapters. If a game wraps
the library with a binary decoder or encoder, that adapter remains part of the
game's trust boundary.

## Disclosure expectations

Include the SaveWeaver version, Node.js version, platform, minimal project
configuration, synthetic input, exact command, and observed output. We will
acknowledge a complete report as soon as practical and coordinate remediation
before public disclosure.
