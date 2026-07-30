import assert from "node:assert/strict";
import test from "node:test";

import {
  applyOperations,
  validateMigrationDefinition,
  validateOperation,
} from "../src/operations.js";

test("rename moves a value without mutating the input", () => {
  const source = { player: { xp: 12 } };
  const result = applyOperations(source, [
    { op: "rename", from: "/player/xp", to: "/player/experience" },
  ]);
  assert.deepEqual(source, { player: { xp: 12 } });
  assert.deepEqual(result.output, { player: { experience: 12 } });
  assert.equal(result.changes.length, 2);
});

test("copy creates parents when requested", () => {
  const result = applyOperations({ player: { name: "Nova" } }, [
    {
      op: "copy",
      from: "/player/name",
      to: "/profile/display_name",
      create_parents: true,
    },
  ]);
  assert.equal(result.output.player.name, "Nova");
  assert.equal(result.output.profile.display_name, "Nova");
});

test("set and set_default have distinct overwrite behavior", () => {
  const result = applyOperations({ level: 4 }, [
    { op: "set_default", path: "/level", value: 1 },
    { op: "set_default", path: "/tokens", value: 0 },
    { op: "set", path: "/level", value: 5 },
  ]);
  assert.deepEqual(result.output, { level: 5, tokens: 0 });
  assert.equal(result.changes.length, 2);
});

test("delete can ignore a missing legacy path", () => {
  const result = applyOperations({ active: true }, [
    { op: "delete", path: "/legacy", if_missing: "ignore" },
  ]);
  assert.deepEqual(result.output, { active: true });
});

test("map_value maps exact JSON values", () => {
  const result = applyOperations({ difficulty: "hard" }, [
    {
      op: "map_value",
      path: "/difficulty",
      cases: [
        { from: "normal", to: "standard" },
        { from: "hard", to: "veteran" },
      ],
    },
  ]);
  assert.equal(result.output.difficulty, "veteran");
});

test("map_value can keep or reject unmapped values", () => {
  const operation = {
    op: "map_value",
    path: "/mode",
    cases: [{ from: "old", to: "new" }],
  };
  assert.throws(() => applyOperations({ mode: "custom" }, [operation]), {
    code: "MIGRATION_OPERATION_FAILED",
  });
  assert.equal(
    applyOperations({ mode: "custom" }, [{ ...operation, if_unmapped: "keep" }]).output.mode,
    "custom",
  );
});

test("number composes scaling, offset, clamp, and rounding", () => {
  const result = applyOperations({ xp: 9 }, [
    { op: "number", path: "/xp", multiply: 1.25, add: 0.5, max: 10, round: "floor" },
  ]);
  assert.equal(result.output.xp, 10);
});

test("number rejects non-numeric input without partial mutation", () => {
  const source = { xp: "nine", untouched: true };
  assert.throws(
    () =>
      applyOperations(source, [
        { op: "set", path: "/untouched", value: false },
        { op: "number", path: "/xp", multiply: 2 },
      ]),
    { code: "MIGRATION_OPERATION_FAILED" },
  );
  assert.deepEqual(source, { xp: "nine", untouched: true });
});

test("for_each applies relative operations to every array member", () => {
  const result = applyOperations(
    { inventory: [{ qty: 1 }, { qty: 3 }] },
    [
      {
        op: "for_each",
        path: "/inventory",
        operations: [{ op: "rename", from: "/qty", to: "/quantity" }],
      },
    ],
  );
  assert.deepEqual(result.output.inventory, [{ quantity: 1 }, { quantity: 3 }]);
});

test("for_each supports objects as keyed collections", () => {
  const result = applyOperations(
    { quests: { alpha: { done: false }, beta: { done: true } } },
    [
      {
        op: "for_each",
        path: "/quests",
        operations: [{ op: "rename", from: "/done", to: "/completed" }],
      },
    ],
  );
  assert.equal(result.output.quests.alpha.completed, false);
  assert.equal(result.output.quests.beta.completed, true);
});

test("assert checks presence, type, equality, and sets", () => {
  const source = { player: { level: 4 }, mode: "normal" };
  assert.doesNotThrow(() =>
    applyOperations(source, [
      { op: "assert", path: "/player", exists: true, type: "object" },
      { op: "assert", path: "/player/level", equals: 4 },
      { op: "assert", path: "/mode", one_of: ["normal", "hard"] },
      { op: "assert", path: "/removed", exists: false },
    ]),
  );
  assert.throws(
    () => applyOperations(source, [{ op: "assert", path: "/mode", equals: "hard" }]),
    { code: "MIGRATION_OPERATION_FAILED" },
  );
});

test("rename refuses to overwrite an existing destination by default", () => {
  assert.throws(
    () =>
      applyOperations({ old: 1, next: 2 }, [
        { op: "rename", from: "/old", to: "/next" },
      ]),
    { code: "MIGRATION_OPERATION_FAILED" },
  );
});

test("operation validation rejects malformed definitions", () => {
  assert.equal(validateOperation({ op: "number", path: "/xp" }).length, 1);
  assert.equal(validateOperation({ op: "unknown" })[0].includes("must be one of"), true);
  assert.equal(
    validateOperation({ op: "for_each", path: "/items", operations: [] }).length,
    1,
  );
  assert.equal(
    validateOperation({ op: "move", from: "/player", to: "/player/legacy" }).some(
      (issue) => issue.includes("descendant"),
    ),
    true,
  );
  assert.equal(
    validateOperation({ op: "delete", path: "/legacy", if_missing: "maybe" }).some(
      (issue) => issue.includes("if_missing"),
    ),
    true,
  );
});

test("move refuses a descendant target at runtime", () => {
  assert.throws(
    () =>
      applyOperations({ player: { name: "Nova" } }, [
        { op: "move", from: "/player", to: "/player/legacy" },
      ]),
    { code: "MIGRATION_OPERATION_FAILED" },
  );
});

test("migration validation reports identity, range, and operation issues", () => {
  const issues = validateMigrationDefinition({
    id: "Bad ID",
    from: 2,
    to: 1,
    description: "",
    operations: [],
  });
  assert.equal(issues.length >= 4, true);
});
