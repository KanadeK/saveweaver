import { spawnSync } from "node:child_process";
import path from "node:path";

import { repositoryRoot } from "./lib/repository.mjs";

const checks = [
  ["static check", ["scripts/static-check.mjs"]],
  ["format check", ["scripts/format-check.mjs"]],
  [
    "tests with coverage",
    [
      "--test",
      "--experimental-test-coverage",
      "--test-coverage-lines=90",
      "--test-coverage-functions=90",
      "--test-coverage-branches=80",
    ],
  ],
  [
    "contract lock",
    ["bin/saveweaver.js", "lock", "--project", "examples/space-ranger", "--check"],
  ],
  [
    "compatibility matrix",
    ["bin/saveweaver.js", "matrix", "--project", "examples/space-ranger"],
  ],
  ["release package", ["scripts/package-release.mjs"]],
  ["release verification", ["scripts/verify-release.mjs"]],
];

for (const [label, arguments_] of checks) {
  process.stdout.write(`\n== ${label} ==\n`);
  const result = spawnSync(process.execPath, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.stderr.write(`Verification stopped at: ${label}\n`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write("\nSaveWeaver release gate passed.\n");
