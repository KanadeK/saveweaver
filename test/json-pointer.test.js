import assert from "node:assert/strict";
import test from "node:test";

import {
  deleteAt,
  getAt,
  hasAt,
  joinPointer,
  parsePointer,
  setAt,
} from "../src/json-pointer.js";

test("parsePointer handles the root and RFC 6901 escapes", () => {
  assert.deepEqual(parsePointer(""), []);
  assert.deepEqual(parsePointer("/a~1b/m~0n"), ["a/b", "m~n"]);
});

test("parsePointer rejects malformed pointers and escapes", () => {
  assert.throws(() => parsePointer("player/name"), { code: "INVALID_POINTER" });
  assert.throws(() => parsePointer("/bad~2escape"), { code: "INVALID_POINTER" });
});

test("getAt reads nested objects and arrays", () => {
  const document = { player: { inventory: [{ id: "laser" }] } };
  assert.equal(getAt(document, "/player/inventory/0/id"), "laser");
  assert.equal(getAt(document, ""), document);
});

test("getAt rejects missing properties and invalid array indices", () => {
  assert.throws(() => getAt({ items: [] }, "/items/0"), { code: "POINTER_NOT_FOUND" });
  assert.throws(() => getAt({ items: ["x"] }, "/items/01"), {
    code: "INVALID_POINTER_INDEX",
  });
});

test("hasAt distinguishes absent keys from null values", () => {
  const document = { present: null };
  assert.equal(hasAt(document, "/present"), true);
  assert.equal(hasAt(document, "/absent"), false);
});

test("setAt creates parents when explicitly enabled", () => {
  const document = {};
  setAt(document, "/profile/name", "Nova", { createParents: true });
  assert.deepEqual(document, { profile: { name: "Nova" } });
});

test("setAt refuses accidental overwrite", () => {
  const document = { profile: { name: "Nova" } };
  assert.throws(
    () => setAt(document, "/profile/name", "Mira", { overwrite: false }),
    { code: "DESTINATION_EXISTS" },
  );
});

test("setAt supports array replacement and append", () => {
  const document = { values: [1] };
  setAt(document, "/values/0", 2);
  setAt(document, "/values/-", 3);
  assert.deepEqual(document.values, [2, 3]);
});

test("deleteAt removes object fields and array elements", () => {
  const document = { player: { legacy: true }, values: ["a", "b"] };
  assert.equal(deleteAt(document, "/player/legacy"), true);
  assert.equal(deleteAt(document, "/values/0"), "a");
  assert.deepEqual(document, { player: {}, values: ["b"] });
});

test("root mutation is rejected", () => {
  assert.throws(() => setAt({}, "", 1), { code: "ROOT_POINTER_NOT_ALLOWED" });
  assert.throws(() => deleteAt({}, ""), { code: "ROOT_POINTER_NOT_ALLOWED" });
});

test("joinPointer composes nested operation paths", () => {
  assert.equal(joinPointer("/inventory/0", "/quantity"), "/inventory/0/quantity");
  assert.equal(joinPointer("", "/player"), "/player");
  assert.equal(joinPointer("/player", ""), "/player");
});
