import { readFile } from "node:fs/promises";
import path from "node:path";

import { relativePath, walkFiles } from "./lib/repository.mjs";
import { inspectTextFormat } from "./lib/text-format.mjs";

const textExtensions = new Set([
  "",
  ".cmd",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sh",
  ".txt",
  ".yaml",
  ".yml",
]);
const failures = [];
let checked = 0;

for (const filePath of await walkFiles()) {
  const extension = path.extname(filePath).toLowerCase();
  if (!textExtensions.has(extension)) continue;
  const source = await readFile(filePath, "utf8");
  const relative = relativePath(filePath);
  checked += 1;
  failures.push(...inspectTextFormat(source, { extension, relative }));
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Format check passed: ${checked} text files.\n`);
}
