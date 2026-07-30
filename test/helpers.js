import { cp, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const exampleRoot = path.join(repositoryRoot, "examples", "space-ranger");

export function captureStream() {
  let value = "";
  return {
    write(chunk) {
      value += String(chunk);
      return true;
    },
    text() {
      return value;
    },
  };
}

export async function temporaryDirectory(prefix = "saveweaver-test-") {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    path: directory,
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

export async function copyExample() {
  const temporary = await temporaryDirectory();
  const destination = path.join(temporary.path, "project");
  await cp(exampleRoot, destination, { recursive: true });
  return { ...temporary, project: destination };
}
