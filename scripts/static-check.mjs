import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { PACKAGE_VERSION } from "../src/version.js";
import {
  exists,
  relativePath,
  repositoryRoot,
  walkFiles,
} from "./lib/repository.mjs";

const files = await walkFiles();
const failures = [];
let checkedJavaScript = 0;
let checkedJson = 0;
let checkedLinks = 0;

for (const filePath of files) {
  const relative = relativePath(filePath);
  const extension = path.extname(filePath).toLowerCase();
  if ([".js", ".mjs"].includes(extension)) {
    const result = spawnSync(process.execPath, ["--check", filePath], {
      cwd: repositoryRoot,
      encoding: "utf8",
      shell: false,
    });
    checkedJavaScript += 1;
    if (result.status !== 0) {
      failures.push(`${relative}: JavaScript syntax check failed\n${result.stderr}`);
    }
  }
  if (extension === ".json") {
    try {
      JSON.parse(await readFile(filePath, "utf8"));
      checkedJson += 1;
    } catch (error) {
      failures.push(`${relative}: invalid JSON (${error.message})`);
    }
  }
  if (extension === ".md") {
    const source = await readFile(filePath, "utf8");
    const linkPattern = /\[[^\]]*\]\(([^)]+)\)/gu;
    for (const match of source.matchAll(linkPattern)) {
      const target = match[1].trim().replace(/^<|>$/gu, "");
      if (
        target === "" ||
        target.startsWith("#") ||
        /^[a-z][a-z0-9+.-]*:/iu.test(target)
      ) {
        continue;
      }
      const withoutAnchor = target.split("#", 1)[0];
      const resolved = path.resolve(path.dirname(filePath), decodeURIComponent(withoutAnchor));
      checkedLinks += 1;
      if (!(await exists(resolved))) {
        failures.push(`${relative}: broken local link ${target}`);
      }
    }
  }
}

const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
);
if (packageJson.version !== PACKAGE_VERSION) {
  failures.push(
    `Version mismatch: package.json=${packageJson.version}, src/version.js=${PACKAGE_VERSION}`,
  );
}
const action = await readFile(path.join(repositoryRoot, "action.yml"), "utf8");
if (!/using:\s*node24/u.test(action)) {
  failures.push("action.yml must use the supported node24 runtime.");
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:github_pat|gho|ghp|ghr|ghs|ghu)_[A-Za-z0-9_]{20,}\b/u,
  /\bsk-[A-Za-z0-9]{32,}\b/u,
];
for (const filePath of files) {
  const extension = path.extname(filePath).toLowerCase();
  if (![".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".txt"].includes(extension)) {
    continue;
  }
  const source = await readFile(filePath, "utf8");
  for (const pattern of secretPatterns) {
    if (pattern.test(source)) {
      failures.push(`${relativePath(filePath)}: possible credential detected`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Static check passed: ${checkedJavaScript} JavaScript files, ${checkedJson} JSON files, ${checkedLinks} local links, and secret patterns.\n`,
  );
}
