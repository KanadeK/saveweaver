import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { migrateDocument } from "../src/engine.js";
import { checkLock } from "../src/lock.js";
import { applyOperations } from "../src/operations.js";
import { documentVersion, loadProject } from "../src/project.js";
import { verifyReceipt } from "../src/receipt.js";
import { validateSchema } from "../src/schema.js";
import { canonicalJson, readJson } from "../src/util.js";
import { copyExample } from "./helpers.js";

async function replaceJson(filePath, transform) {
  const value = await readJson(filePath);
  await writeFile(filePath, canonicalJson(transform(value)), "utf8");
}

test("numeric operations cover clamp and rounding modes", () => {
  const result = applyOperations({ low: -2, high: 11, half: 2.4 }, [
    { op: "number", path: "/low", min: 0, round: "ceil" },
    { op: "number", path: "/high", max: 10, round: "nearest" },
    { op: "number", path: "/half", multiply: 0.5, round: "none" },
  ]);
  assert.deepEqual(result.output, { low: 0, high: 10, half: 1.2 });
});

test("missing operations can ignore absent paths", () => {
  const result = applyOperations({ stable: true }, [
    { op: "copy", from: "/missing", to: "/copy", if_missing: "ignore" },
    { op: "map_value", path: "/missing", cases: [{ from: 1, to: 2 }], if_missing: "ignore" },
    { op: "number", path: "/missing", add: 1, if_missing: "ignore" },
  ]);
  assert.deepEqual(result.output, { stable: true });
});

test("operation errors cover missing parents, collection types, and assertions", () => {
  assert.throws(
    () =>
      applyOperations({ source: 1 }, [
        { op: "copy", from: "/source", to: "/nested/value", create_parents: false },
      ]),
    { code: "MIGRATION_OPERATION_FAILED" },
  );
  assert.throws(
    () =>
      applyOperations({ items: "not-an-array" }, [
        {
          op: "for_each",
          path: "/items",
          operations: [{ op: "set", path: "/seen", value: true }],
        },
      ]),
    { code: "MIGRATION_OPERATION_FAILED" },
  );
  assert.throws(
    () => applyOperations({ value: 1 }, [{ op: "assert", path: "/value", type: "string" }]),
    { code: "MIGRATION_OPERATION_FAILED" },
  );
  assert.throws(
    () => applyOperations({}, [{ op: "assert", path: "/value", exists: true }]),
    { code: "MIGRATION_OPERATION_FAILED" },
  );
});

test("schema validation covers object, array, and exclusive bounds", () => {
  const contract = {
    type: "object",
    minProperties: 2,
    maxProperties: 3,
    properties: {
      ratio: {
        type: "number",
        exclusiveMinimum: 0,
        exclusiveMaximum: 1,
      },
      label: { type: "string", maxLength: 3 },
      values: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: { type: "integer" },
      },
    },
    additionalProperties: { type: "string" },
  };
  const errors = validateSchema(
    { ratio: 1, label: "long", values: [1], extra: 4 },
    contract,
  );
  assert.equal(errors.some((error) => error.keyword === "exclusiveMaximum"), true);
  assert.equal(errors.some((error) => error.keyword === "maxLength"), true);
  assert.equal(errors.some((error) => error.keyword === "minItems"), true);
  assert.equal(errors.some((error) => error.path === "/extra"), true);
  assert.equal(errors.some((error) => error.keyword === "maxProperties"), true);
});

test("schema references report unresolved and circular refs", () => {
  assert.equal(validateSchema("value", { $ref: "#/$defs/missing" })[0].keyword, "$ref");
  const circular = { $defs: { loop: { $ref: "#/$defs/loop" } }, $ref: "#/$defs/loop" };
  assert.equal(validateSchema("value", circular)[0].keyword, "$ref");
});

test("documentVersion diagnoses missing and invalid versions", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const project = await loadProject(temporary.project);
  assert.throws(() => documentVersion(project, {}), { code: "SAVE_VERSION_MISSING" });
  assert.throws(
    () => documentVersion(project, { meta: { save_version: "one" } }),
    { code: "INVALID_SAVE_VERSION" },
  );
});

test("migration target and operation failures are surfaced with context", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const project = await loadProject(temporary.project);
  const source = await readJson(path.join(temporary.project, "fixtures", "v1", "veteran.json"));
  assert.throws(() => migrateDocument(project, source, { toVersion: 4 }), {
    code: "INVALID_TARGET_VERSION",
  });
  project.migrations[0].operations.unshift({
    op: "assert",
    path: "/difficulty",
    equals: "impossible",
  });
  assert.throws(() => migrateDocument(project, source), { code: "MIGRATION_FAILED" });
});

test("a missing configured schema is a migration error", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const project = await loadProject(temporary.project);
  const source = await readJson(path.join(temporary.project, "fixtures", "v1", "veteran.json"));
  project.schemas.delete(2);
  assert.throws(() => migrateDocument(project, source), { code: "SCHEMA_MISSING" });
});

test("loadProject rejects paths that escape the project", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.project, "saveweaver.json");
  await replaceJson(configPath, (config) => ({
    ...config,
    schemas: { ...config.schemas, 1: "../outside.json" },
  }));
  await assert.rejects(() => loadProject(temporary.project), {
    code: "PATH_OUTSIDE_PROJECT",
  });
});

test("loadProject rejects unsupported schema keywords", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const schemaPath = path.join(temporary.project, "schemas", "v3.schema.json");
  await replaceJson(schemaPath, (schema) => ({ ...schema, format: "game-save" }));
  await assert.rejects(() => loadProject(temporary.project), {
    code: "UNSUPPORTED_SCHEMA",
  });
});

test("loadProject rejects malformed migration files", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const migrationPath = path.join(
    temporary.project,
    "migrations",
    "001-player-progression.json",
  );
  await replaceJson(migrationPath, (migration) => ({ ...migration, id: "Invalid ID" }));
  await assert.rejects(() => loadProject(temporary.project), {
    code: "INVALID_MIGRATION",
  });
});

test("loadProject rejects migration graph gaps", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.project, "saveweaver.json");
  await replaceJson(configPath, (config) => ({
    ...config,
    migrations: config.migrations.slice(0, 1),
  }));
  await assert.rejects(() => loadProject(temporary.project), {
    code: "INVALID_MIGRATION_GRAPH",
  });
});

test("loadProject rejects missing or empty fixture directories", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.project, "saveweaver.json");
  await replaceJson(configPath, (config) => ({ ...config, fixture_dirs: ["missing"] }));
  await assert.rejects(() => loadProject(temporary.project), {
    code: "FIXTURE_DIRECTORY_MISSING",
  });

  await mkdir(path.join(temporary.project, "empty"));
  await replaceJson(configPath, (config) => ({ ...config, fixture_dirs: ["empty"] }));
  await assert.rejects(() => loadProject(temporary.project), { code: "NO_FIXTURES" });
});

test("loadProject requires a current-version schema", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  const configPath = path.join(temporary.project, "saveweaver.json");
  await replaceJson(configPath, (config) => {
    const schemas = { ...config.schemas };
    delete schemas["3"];
    return { ...config, schemas };
  });
  await assert.rejects(() => loadProject(temporary.project), { code: "INVALID_CONFIG" });
});

test("checkLock reports a missing lock and receipt format drift", async (context) => {
  const temporary = await copyExample();
  context.after(temporary.cleanup);
  await rm(path.join(temporary.project, ".saveweaver.lock.json"));
  const project = await loadProject(temporary.project);
  const lock = await checkLock(project);
  assert.equal(lock.ok, false);
  assert.match(lock.issues[0], /missing/);

  const receipt = { format: 99, output_sha256: "wrong" };
  const verified = verifyReceipt(receipt, {});
  assert.equal(verified.ok, false);
  assert.equal(verified.issues.length, 2);
});
