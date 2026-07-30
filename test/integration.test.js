import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { migrateDocument } from "../src/engine.js";
import { checkLock, createLock } from "../src/lock.js";
import { runCompatibilityMatrix } from "../src/matrix.js";
import { loadProject } from "../src/project.js";
import { createReceipt, verifyReceipt } from "../src/receipt.js";
import { canonicalJson, readJson } from "../src/util.js";
import { copyExample, exampleRoot } from "./helpers.js";

test("the bundled example loads and its compatibility matrix passes", async () => {
  const project = await loadProject(exampleRoot);
  const report = await runCompatibilityMatrix(project);
  assert.deepEqual(report.summary, { total: 4, passed: 4, failed: 0, ok: true });
  assert.deepEqual(
    report.fixtures.map((fixture) => fixture.source_version),
    [1, 1, 2, 3],
  );
});

test("the v1 veteran fixture migrates to the documented v3 output", async () => {
  const project = await loadProject(exampleRoot);
  const source = await readJson(
    path.join(exampleRoot, "fixtures", "v1", "veteran.json"),
  );
  const expected = await readJson(
    path.join(exampleRoot, "expected", "v3", "veteran.json"),
  );
  const result = migrateDocument(project, source);
  assert.equal(result.fromVersion, 1);
  assert.equal(result.toVersion, 3);
  assert.deepEqual(result.output, expected);
  assert.equal(result.steps.length, 2);
});

test("a migration receipt verifies the exact output and rejects tampering", async () => {
  const project = await loadProject(exampleRoot);
  const sourcePath = path.join(exampleRoot, "fixtures", "v2", "shipyard.json");
  const source = await readJson(sourcePath);
  const result = migrateDocument(project, source);
  const receipt = createReceipt(project, sourcePath, result);
  assert.equal(verifyReceipt(receipt, result.output).ok, true);
  const tampered = structuredClone(result.output);
  tampered.wallet.credits += 1;
  assert.equal(verifyReceipt(receipt, tampered).ok, false);
});

test("the checked-in contract lock matches source contracts", async () => {
  const project = await loadProject(exampleRoot);
  const result = await checkLock(project);
  assert.equal(result.ok, true);
  assert.equal((await createLock(project)).files.length, 6);
});

test("contract drift is diagnosed by file", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const schemaPath = path.join(temporary.project, "schemas", "v3.schema.json");
  const source = await readFile(schemaPath, "utf8");
  await writeFile(schemaPath, source.replace("Space Ranger save v3", "Changed title"), "utf8");
  const project = await loadProject(temporary.project);
  const result = await checkLock(project);
  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.includes("schemas/v3.schema.json")), true);
});

test("migration failure preserves actionable schema diagnostics", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const fixturePath = path.join(temporary.project, "fixtures", "v1", "broken.json");
  await writeFile(
    fixturePath,
    canonicalJson({
      meta: { save_version: 1, build: "0.8.4" },
      player: { name: "Broken", xp: -1, credits: 0 },
      difficulty: "normal",
      inventory: [],
      unlocks: [],
    }),
    "utf8",
  );
  const project = await loadProject(temporary.project);
  const report = await runCompatibilityMatrix(project);
  const broken = report.fixtures.find((fixture) => fixture.file.endsWith("broken.json"));
  assert.equal(broken.status, "fail");
  assert.equal(broken.error.code, "SCHEMA_VALIDATION_FAILED");
});
