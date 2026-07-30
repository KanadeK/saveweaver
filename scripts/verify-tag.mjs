import process from "node:process";

import { PACKAGE_VERSION } from "../src/version.js";

const tag = process.argv[2];
if (!tag) {
  process.stderr.write("Usage: node scripts/verify-tag.mjs v<package-version>\n");
  process.exitCode = 2;
} else if (tag !== `v${PACKAGE_VERSION}`) {
  process.stderr.write(
    `Tag/version mismatch: tag=${tag}, package=v${PACKAGE_VERSION}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Tag ${tag} matches package version ${PACKAGE_VERSION}.\n`);
}
