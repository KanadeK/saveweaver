import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { PACKAGE_VERSION } from "../src/version.js";
import { findNpmCli, repositoryRoot } from "./lib/repository.mjs";
import { inspectStoredZip } from "./lib/zip.mjs";

const artifacts = path.join(repositoryRoot, "artifacts");
const manifest = JSON.parse(
  await readFile(path.join(artifacts, "release-manifest.json"), "utf8"),
);
if (manifest.version !== PACKAGE_VERSION) {
  throw new Error(`Manifest version mismatch: ${manifest.version}`);
}
for (const file of manifest.files) {
  const bytes = await readFile(path.join(artifacts, file.name));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== file.sha256 || bytes.length !== file.size) {
    throw new Error(`Release artifact mismatch: ${file.name}`);
  }
}

const zip = manifest.files.find((file) => file.name.endsWith(".zip"));
const zipEntries = await inspectStoredZip(path.join(artifacts, zip.name));
if (
  zipEntries.length === 0 ||
  zipEntries.some((entry) => !entry.valid) ||
  !zipEntries.some((entry) => entry.name.endsWith("/bin/saveweaver.js"))
) {
  throw new Error("Portable ZIP structure or CRC validation failed.");
}

const tarball = manifest.files.find((file) => file.name.endsWith(".tgz"));
const temporary = await mkdtemp(path.join(os.tmpdir(), "saveweaver-package-"));
try {
  const npmCli = await findNpmCli();
  const install = spawnSync(
    process.execPath,
    [
      npmCli,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      temporary,
      path.join(artifacts, tarball.name),
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: path.join(temporary, ".npm-cache"),
      },
      shell: false,
    },
  );
  if (install.status !== 0) {
    throw new Error(`Clean package install failed:\n${install.stderr || install.stdout}`);
  }
  const installedCli = path.join(
    temporary,
    "node_modules",
    "game-saveweaver",
    "bin",
    "saveweaver.js",
  );
  const version = spawnSync(process.execPath, [installedCli, "--version"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  });
  if (version.status !== 0 || version.stdout.trim() !== PACKAGE_VERSION) {
    throw new Error(`Installed CLI smoke test failed:\n${version.stderr || version.stdout}`);
  }
  const matrix = spawnSync(
    process.execPath,
    [installedCli, "matrix", "--project", path.join(repositoryRoot, "examples", "space-ranger")],
    { cwd: repositoryRoot, encoding: "utf8", shell: false },
  );
  if (matrix.status !== 0 || !matrix.stdout.includes("4/4 fixtures passed")) {
    throw new Error(`Installed CLI matrix smoke test failed:\n${matrix.stderr || matrix.stdout}`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}

process.stdout.write(
  `Release verification passed: ${manifest.files.length} artifacts, ${zipEntries.length} ZIP entries, clean install, and example matrix.\n`,
);
