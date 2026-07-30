import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";

import { SaveWeaverError } from "./errors.js";

export function deepClone(value) {
  return structuredClone(value);
}

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }

  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Json(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

export async function sha256File(filePath) {
  return sha256Bytes(await readFile(filePath));
}

export async function readJson(filePath, label = "JSON file") {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    throw new SaveWeaverError(`Cannot read ${label}: ${filePath}`, {
      code: "FILE_READ_FAILED",
      cause: error,
    });
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new SaveWeaverError(`Invalid JSON in ${label} ${filePath}${detail}`, {
      code: "INVALID_JSON",
      cause: error,
    });
  }
}

export async function writeJsonAtomic(filePath, value) {
  await writeTextAtomic(filePath, canonicalJson(value));
}

export async function writeTextAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.saveweaver-${process.pid}.tmp`,
  );

  try {
    await writeFile(temporaryPath, value, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw new SaveWeaverError(`Cannot write file atomically: ${filePath}`, {
      code: "ATOMIC_WRITE_FAILED",
      cause: error,
    });
  }
}

export async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function walkJsonFiles(directory) {
  const results = [];

  async function visit(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      throw new SaveWeaverError(`Cannot scan directory: ${current}`, {
        code: "DIRECTORY_READ_FAILED",
        cause: error,
      });
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
        results.push(target);
      }
    }
  }

  await visit(directory);
  return results;
}

export function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

export function relativePosix(root, filePath) {
  return toPosixPath(path.relative(root, filePath));
}

export function displayValue(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  const rendered = JSON.stringify(value);
  return rendered === undefined ? String(value) : rendered;
}

export function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
