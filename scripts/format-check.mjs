import { readFile } from "node:fs/promises";
import path from "node:path";

import { relativePath, walkFiles } from "./lib/repository.mjs";

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
  if (!textExtensions.has(path.extname(filePath).toLowerCase())) continue;
  const source = await readFile(filePath, "utf8");
  const relative = relativePath(filePath);
  checked += 1;
  if (source.charCodeAt(0) === 0xfeff) failures.push(`${relative}: UTF-8 BOM is not allowed`);
  if (source.includes("\r")) failures.push(`${relative}: use LF line endings`);
  if (!source.endsWith("\n")) failures.push(`${relative}: missing final newline`);
  source.split("\n").forEach((line, index) => {
    if (/[ \t]+$/u.test(line)) failures.push(`${relative}:${index + 1}: trailing whitespace`);
  });
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Format check passed: ${checked} text files.\n`);
}
