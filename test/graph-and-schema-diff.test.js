import assert from "node:assert/strict";
import test from "node:test";

import { planMigrations, validateMigrationGraph } from "../src/graph.js";
import { diffSchemas } from "../src/schema-diff.js";

const migrations = [
  { id: "one-two", from: 1, to: 2 },
  { id: "two-three", from: 2, to: 3 },
];

test("planMigrations returns the ordered chain", () => {
  assert.deepEqual(
    planMigrations(migrations, 1, 3).map((migration) => migration.id),
    ["one-two", "two-three"],
  );
  assert.deepEqual(planMigrations(migrations, 3, 3), []);
});

test("planMigrations rejects downgrades and gaps", () => {
  assert.throws(() => planMigrations(migrations, 3, 2), {
    code: "DOWNGRADE_NOT_SUPPORTED",
  });
  assert.throws(() => planMigrations(migrations, 0, 3), {
    code: "MIGRATION_PATH_MISSING",
  });
});

test("planMigrations rejects ambiguous and overshooting graphs", () => {
  assert.throws(
    () => planMigrations([...migrations, { id: "alternate", from: 1, to: 3 }], 1, 3),
    { code: "AMBIGUOUS_MIGRATION_PATH" },
  );
  assert.throws(() => planMigrations([{ id: "jump", from: 1, to: 4 }], 1, 3), {
    code: "MIGRATION_PATH_OVERSHOOT",
  });
});

test("validateMigrationGraph detects duplicates, ambiguity, and missing paths", () => {
  const issues = validateMigrationGraph(
    [
      { id: "same", from: 1, to: 2 },
      { id: "same", from: 1, to: 3 },
    ],
    [0, 1, 3],
    3,
  );
  assert.equal(issues.some((issue) => issue.includes("Duplicate")), true);
  assert.equal(issues.some((issue) => issue.includes("Ambiguous")), true);
  assert.equal(issues.some((issue) => issue.includes("No migration path")), true);
});

test("schema diff identifies newly required properties", () => {
  const report = diffSchemas(
    { type: "object", properties: { name: { type: "string" } } },
    {
      type: "object",
      required: ["level"],
      properties: { name: { type: "string" }, level: { type: "integer" } },
    },
  );
  assert.equal(report.breaking.some((change) => change.kind === "required_added"), true);
});

test("schema diff identifies narrowed type, enum, and bounds", () => {
  const report = diffSchemas(
    {
      type: ["integer", "string"],
      enum: ["normal", "hard"],
      minimum: 0,
      maximum: 100,
    },
    { type: "integer", enum: ["hard"], minimum: 1, maximum: 90 },
  );
  assert.equal(report.breaking.length, 4);
});

test("schema diff marks optional additions as informational", () => {
  const report = diffSchemas(
    { type: "object", properties: {} },
    { type: "object", properties: { tokens: { type: "integer" } } },
  );
  assert.equal(report.changes[0].severity, "info");
});
