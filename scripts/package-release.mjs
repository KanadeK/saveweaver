import { createHash } from "node:crypto";
import { readFile, rename, rm, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { canonicalJson } from "../src/util.js";
import { PACKAGE_VERSION } from "../src/version.js";
import {
  findNpmCli,
  relativePath,
  repositoryRoot,
  walkFiles,
} from "./lib/repository.mjs";
import { normalizeWindowsLauncher } from "./lib/text-format.mjs";
import { createDeterministicZip, inspectStoredZip } from "./lib/zip.mjs";

const artifacts = path.resolve(repositoryRoot, "artifacts");
if (path.dirname(artifacts) !== repositoryRoot || path.basename(artifacts) !== "artifacts") {
  throw new Error(`Refusing to clean unexpected artifact path: ${artifacts}`);
}
await rm(artifacts, { recursive: true, force: true });
await mkdir(artifacts, { recursive: true });

const npmCli = await findNpmCli();
const packed = spawnSync(
  process.execPath,
  [npmCli, "pack", "--pack-destination", artifacts, "--json"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: path.join(artifacts, ".npm-cache"),
    },
    shell: false,
  },
);
if (packed.status !== 0) {
  throw new Error(`npm pack failed:\n${packed.stderr || packed.stdout}`);
}
const packResult = JSON.parse(packed.stdout);
const npmName = packResult[0].filename;
const tarballName = `saveweaver-v${PACKAGE_VERSION}.tgz`;
await rename(path.join(artifacts, npmName), path.join(artifacts, tarballName));
await rm(path.join(artifacts, ".npm-cache"), { recursive: true, force: true });

const portableRoots = ["action", "bin", "docs", "src"];
const portableFiles = [
  "action.yml",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "package.json",
  "README.md",
  "SECURITY.md",
  "portable/saveweaver",
  "portable/saveweaver.cmd",
];
for (const directory of portableRoots) {
  for (const filePath of await walkFiles(path.join(repositoryRoot, directory))) {
    portableFiles.push(relativePath(filePath));
  }
}
const windowsLauncherData = Buffer.from(
  normalizeWindowsLauncher(
    await readFile(path.join(repositoryRoot, "portable", "saveweaver.cmd"), "utf8"),
  ),
  "utf8",
);
const prefix = `saveweaver-v${PACKAGE_VERSION}`;
const entries = [...new Set(portableFiles)].sort().map((relative) => ({
  name:
    relative === "portable/saveweaver"
      ? `${prefix}/saveweaver`
      : relative === "portable/saveweaver.cmd"
        ? `${prefix}/saveweaver.cmd`
        : `${prefix}/${relative}`,
  source: path.join(repositoryRoot, relative),
  data: relative === "portable/saveweaver.cmd" ? windowsLauncherData : undefined,
  executable: relative === "portable/saveweaver" || relative === "bin/saveweaver.js",
}));
const zipName = `saveweaver-v${PACKAGE_VERSION}-portable.zip`;
const zipPath = path.join(artifacts, zipName);
await createDeterministicZip(zipPath, entries);
const inspected = await inspectStoredZip(zipPath);
if (inspected.length !== entries.length || inspected.some((entry) => !entry.valid)) {
  throw new Error("Portable ZIP verification failed.");
}

async function fileRecord(name) {
  const filePath = path.join(artifacts, name);
  const bytes = await readFile(filePath);
  return {
    name,
    size: (await stat(filePath)).size,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

const releaseFiles = [
  await fileRecord(tarballName),
  await fileRecord(zipName),
];
const manifest = {
  format: 1,
  project: "saveweaver",
  version: PACKAGE_VERSION,
  files: releaseFiles,
};
await writeFile(
  path.join(artifacts, "release-manifest.json"),
  canonicalJson(manifest),
  "utf8",
);
await writeFile(
  path.join(artifacts, "checksums.sha256"),
  `${releaseFiles.map((file) => `${file.sha256}  ${file.name}`).join("\n")}\n`,
  "utf8",
);

process.stdout.write(
  `Packaged ${releaseFiles.map((file) => `${file.name} (${file.size} bytes)`).join(", ")}.\n`,
);
