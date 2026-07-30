import assert from "node:assert/strict";
import test from "node:test";

import { checkSchemaSupport, validateSchema } from "../src/schema.js";

const schema = {
  type: "object",
  required: ["name", "level"],
  properties: {
    name: { type: "string", minLength: 2, pattern: "^[A-Z]" },
    level: { type: "integer", minimum: 1, maximum: 99 },
    tags: {
      type: "array",
      uniqueItems: true,
      items: { type: "string" },
    },
  },
  additionalProperties: false,
};

test("validateSchema accepts a valid document", () => {
  assert.deepEqual(validateSchema({ name: "Nova", level: 4, tags: ["pilot"] }, schema), []);
});

test("validateSchema reports required and additional properties", () => {
  const errors = validateSchema({ name: "Nova", cheat: true }, schema);
  assert.equal(errors.some((error) => error.keyword === "required"), true);
  assert.equal(errors.some((error) => error.keyword === "additionalProperties"), true);
});

test("validateSchema checks types and stops unsafe child checks", () => {
  const errors = validateSchema({ name: 42, level: "four" }, schema);
  assert.equal(errors.filter((error) => error.keyword === "type").length, 2);
});

test("validateSchema checks numeric and string bounds", () => {
  const errors = validateSchema({ name: "n", level: 100 }, schema);
  assert.equal(errors.some((error) => error.keyword === "minLength"), true);
  assert.equal(errors.some((error) => error.keyword === "pattern"), true);
  assert.equal(errors.some((error) => error.keyword === "maximum"), true);
});

test("validateSchema checks array uniqueness and item schemas", () => {
  const errors = validateSchema(
    { name: "Nova", level: 2, tags: ["pilot", "pilot", 3] },
    schema,
  );
  assert.equal(errors.some((error) => error.keyword === "uniqueItems"), true);
  assert.equal(errors.some((error) => error.path === "/tags/2"), true);
});

test("validateSchema supports enum, const, and multipleOf", () => {
  const contract = {
    type: "object",
    properties: {
      version: { const: 3 },
      mode: { enum: ["normal", "hard"] },
      score: { type: "number", multipleOf: 0.5 },
    },
  };
  assert.equal(validateSchema({ version: 2, mode: "story", score: 1.2 }, contract).length, 3);
});

test("validateSchema supports local references", () => {
  const contract = {
    $defs: {
      item: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
    },
    type: "array",
    items: { $ref: "#/$defs/item" },
  };
  assert.deepEqual(validateSchema([{ id: "laser" }], contract), []);
  assert.equal(validateSchema([{}], contract)[0].keyword, "required");
});

test("combinators resolve local references against the root schema", () => {
  const contract = {
    $defs: {
      pilot: {
        type: "object",
        required: ["callsign"],
        properties: { callsign: { type: "string" } },
      },
    },
    anyOf: [{ $ref: "#/$defs/pilot" }, { const: null }],
  };
  assert.deepEqual(validateSchema({ callsign: "Nova" }, contract), []);
  assert.equal(validateSchema({}, contract)[0].keyword, "anyOf");
});

test("validateSchema supports allOf, anyOf, oneOf, and not", () => {
  assert.deepEqual(validateSchema(4, { allOf: [{ type: "integer" }, { minimum: 1 }] }), []);
  assert.deepEqual(validateSchema("pilot", { anyOf: [{ type: "integer" }, { type: "string" }] }), []);
  assert.equal(
    validateSchema(4, { oneOf: [{ type: "number" }, { type: "integer" }] })[0].keyword,
    "oneOf",
  );
  assert.equal(validateSchema("admin", { not: { const: "admin" } })[0].keyword, "not");
});

test("boolean schemas allow or reject values", () => {
  assert.deepEqual(validateSchema({ any: "value" }, true), []);
  assert.equal(validateSchema({ any: "value" }, false)[0].keyword, "falseSchema");
});

test("unsupported schema keywords are explicit failures", () => {
  const errors = checkSchemaSupport({ type: "string", format: "email" });
  assert.equal(errors[0].keyword, "unsupported");
  assert.equal(validateSchema("a@example.com", { format: "email" })[0].keyword, "unsupported");
});

test("invalid regular expressions produce diagnostics", () => {
  const errors = validateSchema("value", { type: "string", pattern: "[" });
  assert.equal(errors[0].keyword, "pattern");
});
