import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { runCli } from "../src/cli.js";
import { pathExists, readJson } from "../src/util.js";
import {
  captureStream,
  copyExample,
  exampleRoot,
  temporaryDirectory,
} from "./helpers.js";

async function invoke(arguments_, cwd = exampleRoot) {
  const stdout = captureStream();
  const stderr = captureStream();
  const exitCode = await runCli(arguments_, { cwd, stdout, stderr });
  return { exitCode, stdout: stdout.text(), stderr: stderr.text() };
}

test("CLI exposes help and version", async () => {
  const help = await invoke(["--help"]);
  assert.equal(help.exitCode, 0);
  assert.match(help.stdout, /CI for the save files/);
  const version = await invoke(["--version"]);
  assert.match(version.stdout, /^0\.1\.1/u);
});

test("matrix JSON output is machine-readable", async () => {
  const result = await invoke(["matrix", "--format", "json"]);
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.passed, 4);
});

test("check validates the lock and compatibility matrix", async () => {
  const result = await invoke(["check"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /PASS project is release-ready/);
});

test("plan previews migrations without writing", async () => {
  const result = await invoke(["plan", "fixtures/v1/veteran.json"]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /001-player-progression/);
  assert.match(result.stdout, /Structural changes/);
});

test("migrate dry-run explicitly reports no writes", async () => {
  const result = await invoke([
    "migrate",
    "fixtures/v1/veteran.json",
    "--dry-run",
  ]);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /no files were written/i);
});

test("migrate writes output plus a verifiable receipt", async (context) => {
  const temporary = await temporaryDirectory();
  context.after(temporary.cleanup);
  const outputPath = path.join(temporary.path, "migrated.json");
  const result = await invoke([
    "migrate",
    "fixtures/v1/veteran.json",
    "--out",
    outputPath,
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(await pathExists(outputPath), true);
  assert.equal(await pathExists(`${outputPath}.saveweaver-receipt.json`), true);
  const outputDocument = await readJson(outputPath);
  assert.equal(outputDocument.meta.save_version, 3);
  const verify = await invoke([
    "verify-receipt",
    `${outputPath}.saveweaver-receipt.json`,
    outputPath,
  ]);
  assert.equal(verify.exitCode, 0);

  const refused = await invoke([
    "migrate",
    "fixtures/v1/veteran.json",
    "--out",
    outputPath,
  ]);
  assert.equal(refused.exitCode, 1);
  assert.match(refused.stderr, /OUTPUT_EXISTS/);

  const replaced = await invoke([
    "migrate",
    "fixtures/v1/veteran.json",
    "--out",
    outputPath,
    "--overwrite",
  ]);
  assert.equal(replaced.exitCode, 0);
});

test("in-place migration creates a content-addressed backup", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const sourcePath = path.join(
    temporary.project,
    "fixtures",
    "v1",
    "veteran.json",
  );
  const before = await readFile(sourcePath, "utf8");
  const result = await invoke(
    ["migrate", sourcePath, "--in-place"],
    temporary.project,
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Backup:/);
  const backupMatch = result.stdout.match(/Backup: (.+)\r?\n/u);
  assert.equal(Boolean(backupMatch), true);
  assert.equal(await readFile(backupMatch[1], "utf8"), before);
  assert.equal((await readJson(sourcePath)).meta.save_version, 3);
});

test("init creates a runnable project and lock", async (context) => {
  const temporary = await temporaryDirectory();
  context.after(temporary.cleanup);
  const target = path.join(temporary.path, "my-game");
  const initialized = await invoke(["init", target], temporary.path);
  assert.equal(initialized.exitCode, 0);
  const checked = await invoke(["check"], target);
  assert.equal(checked.exitCode, 0);
  assert.equal(await pathExists(path.join(target, ".saveweaver.lock.json")), true);
});

test("init refuses to overwrite a non-empty directory", async (context) => {
  const temporary = await temporaryDirectory();
  context.after(temporary.cleanup);
  await writeFile(path.join(temporary.path, "keep.txt"), "existing user data\n", "utf8");
  const result = await invoke(["init", temporary.path], temporary.path);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /DIRECTORY_NOT_EMPTY/);
});

test("schema-diff exits non-zero for a breaking contract", async () => {
  const result = await invoke([
    "schema-diff",
    "schemas/v1.schema.json",
    "schemas/v2.schema.json",
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /BREAKING/);
});

test("usage errors use exit code 2", async () => {
  const unknown = await invoke(["unknown"]);
  assert.equal(unknown.exitCode, 2);
  const unsafe = await invoke(["migrate", "fixtures/v1/veteran.json"]);
  assert.equal(unsafe.exitCode, 2);
});
