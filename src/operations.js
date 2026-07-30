import {
  deleteAt,
  escapePointerToken,
  getAt,
  hasAt,
  joinPointer,
  setAt,
} from "./json-pointer.js";
import { SaveWeaverError } from "./errors.js";
import { canonicalJson, deepClone, displayValue, isPlainObject } from "./util.js";

const OPERATION_TYPES = new Set([
  "assert",
  "copy",
  "delete",
  "for_each",
  "map_value",
  "move",
  "number",
  "rename",
  "set",
  "set_default",
]);

function jsonEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function operationError(message, code, details = {}) {
  return new SaveWeaverError(message, { code, details });
}

function validatePointerField(operation, field, issues, at) {
  if (typeof operation[field] !== "string" || !operation[field].startsWith("/")) {
    issues.push(`${at}.${field} must be a JSON Pointer beginning with "/".`);
  }
}

export function validateOperation(operation, at = "operation") {
  const issues = [];
  if (!isPlainObject(operation)) {
    return [`${at} must be an object.`];
  }
  if (!OPERATION_TYPES.has(operation.op)) {
    return [`${at}.op must be one of: ${[...OPERATION_TYPES].sort().join(", ")}.`];
  }

  switch (operation.op) {
    case "assert":
    case "delete":
    case "map_value":
    case "number":
    case "set":
    case "set_default":
      validatePointerField(operation, "path", issues, at);
      break;
    case "copy":
    case "move":
    case "rename":
      validatePointerField(operation, "from", issues, at);
      validatePointerField(operation, "to", issues, at);
      break;
    case "for_each":
      validatePointerField(operation, "path", issues, at);
      if (!Array.isArray(operation.operations) || operation.operations.length === 0) {
        issues.push(`${at}.operations must be a non-empty array.`);
      } else {
        operation.operations.forEach((child, index) => {
          issues.push(...validateOperation(child, `${at}.operations[${index}]`));
        });
      }
      break;
  }

  if (operation.op === "set" && !Object.hasOwn(operation, "value")) {
    issues.push(`${at}.value is required.`);
  }
  if (operation.op === "set_default" && !Object.hasOwn(operation, "value")) {
    issues.push(`${at}.value is required.`);
  }
  if (operation.op === "map_value") {
    if (!Array.isArray(operation.cases) || operation.cases.length === 0) {
      issues.push(`${at}.cases must be a non-empty array.`);
    } else {
      operation.cases.forEach((entry, index) => {
        if (!isPlainObject(entry) || !Object.hasOwn(entry, "from") || !Object.hasOwn(entry, "to")) {
          issues.push(`${at}.cases[${index}] must contain from and to values.`);
        }
      });
    }
    if (
      operation.if_unmapped !== undefined &&
      !["error", "keep"].includes(operation.if_unmapped)
    ) {
      issues.push(`${at}.if_unmapped must be "error" or "keep".`);
    }
  }
  if (operation.op === "number") {
    const modifiers = ["add", "multiply", "min", "max"];
    if (!modifiers.some((field) => operation[field] !== undefined) && operation.round === undefined) {
      issues.push(`${at} must define at least one numeric modifier.`);
    }
    for (const field of modifiers) {
      if (operation[field] !== undefined && typeof operation[field] !== "number") {
        issues.push(`${at}.${field} must be a number.`);
      }
    }
    if (
      operation.round !== undefined &&
      !["ceil", "floor", "nearest", "none"].includes(operation.round)
    ) {
      issues.push(`${at}.round must be ceil, floor, nearest, or none.`);
    }
  }
  if (operation.op === "assert") {
    const predicates = ["exists", "type", "equals", "one_of"];
    if (!predicates.some((field) => Object.hasOwn(operation, field))) {
      issues.push(`${at} must define at least one assertion predicate.`);
    }
  }
  if (
    operation.if_missing !== undefined &&
    !["error", "ignore"].includes(operation.if_missing)
  ) {
    issues.push(`${at}.if_missing must be "error" or "ignore".`);
  }
  if (
    ["move", "rename"].includes(operation.op) &&
    typeof operation.from === "string" &&
    typeof operation.to === "string" &&
    (operation.to === operation.from || operation.to.startsWith(`${operation.from}/`))
  ) {
    issues.push(`${at}.to cannot be the source itself or a descendant of it.`);
  }

  return issues;
}

export function validateMigrationDefinition(migration, at = "migration") {
  const issues = [];
  if (!isPlainObject(migration)) return [`${at} must be an object.`];
  if (typeof migration.id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(migration.id)) {
    issues.push(`${at}.id must use lowercase letters, digits, dots, underscores, or hyphens.`);
  }
  if (!Number.isSafeInteger(migration.from) || migration.from < 0) {
    issues.push(`${at}.from must be a non-negative integer.`);
  }
  if (!Number.isSafeInteger(migration.to) || migration.to <= migration.from) {
    issues.push(`${at}.to must be an integer greater than from.`);
  }
  if (typeof migration.description !== "string" || migration.description.trim() === "") {
    issues.push(`${at}.description must be a non-empty string.`);
  }
  if (!Array.isArray(migration.operations) || migration.operations.length === 0) {
    issues.push(`${at}.operations must be a non-empty array.`);
  } else {
    migration.operations.forEach((operation, index) => {
      issues.push(...validateOperation(operation, `${at}.operations[${index}]`));
    });
  }
  return issues;
}

function recordChange(changes, op, path, before, after) {
  changes.push({
    op,
    path,
    ...(before === undefined ? {} : { before: deepClone(before) }),
    ...(after === undefined ? {} : { after: deepClone(after) }),
  });
}

function missingBehavior(operation) {
  return operation.if_missing ?? "error";
}

function absolute(base, pointer) {
  return joinPointer(base, pointer);
}

function applyAssert(document, operation, base) {
  const pointer = absolute(base, operation.path);
  const exists = hasAt(document, pointer);
  if (operation.exists !== undefined && exists !== operation.exists) {
    throw operationError(
      `Assertion failed at ${pointer}: expected exists=${operation.exists}.`,
      "ASSERTION_FAILED",
      { pointer },
    );
  }
  if (!exists) {
    if (operation.exists === false) return;
    throw operationError(`Assertion target does not exist: ${pointer}`, "ASSERTION_FAILED", {
      pointer,
    });
  }

  const value = getAt(document, pointer);
  if (operation.type !== undefined) {
    const expected = Array.isArray(operation.type) ? operation.type : [operation.type];
    const actual = valueType(value);
    const matches =
      expected.includes(actual) || (actual === "integer" && expected.includes("number"));
    if (!matches) {
      throw operationError(
        `Assertion failed at ${pointer}: expected ${expected.join(" or ")}, received ${actual}.`,
        "ASSERTION_FAILED",
        { pointer, expected, actual },
      );
    }
  }
  if (Object.hasOwn(operation, "equals") && !jsonEqual(value, operation.equals)) {
    throw operationError(
      `Assertion failed at ${pointer}: expected ${displayValue(operation.equals)}, received ${displayValue(value)}.`,
      "ASSERTION_FAILED",
      { pointer, expected: operation.equals, actual: value },
    );
  }
  if (
    operation.one_of &&
    !operation.one_of.some((candidate) => jsonEqual(candidate, value))
  ) {
    throw operationError(
      `Assertion failed at ${pointer}: value is not in the allowed set.`,
      "ASSERTION_FAILED",
      { pointer, expected: operation.one_of, actual: value },
    );
  }
}

function applyTransfer(document, operation, base, changes) {
  const from = absolute(base, operation.from);
  const to = absolute(base, operation.to);
  if (operation.op !== "copy" && (to === from || to.startsWith(`${from}/`))) {
    throw operationError(
      `Cannot ${operation.op} ${from} into itself or its descendant ${to}.`,
      "INVALID_MOVE_TARGET",
      { from, to },
    );
  }
  if (!hasAt(document, from)) {
    if (missingBehavior(operation) === "ignore") return;
    throw operationError(`Source does not exist: ${from}`, "POINTER_NOT_FOUND", { pointer: from });
  }
  const value = deepClone(getAt(document, from));
  const before = hasAt(document, to) ? deepClone(getAt(document, to)) : undefined;
  setAt(document, to, value, {
    createParents: operation.create_parents ?? false,
    overwrite: operation.overwrite ?? false,
  });
  if (operation.op !== "copy") {
    deleteAt(document, from);
  }
  recordChange(changes, operation.op, to, before, value);
  if (operation.op !== "copy") {
    recordChange(changes, operation.op, from, value, undefined);
  }
}

function applyDelete(document, operation, base, changes) {
  const pointer = absolute(base, operation.path);
  if (!hasAt(document, pointer)) {
    if (missingBehavior(operation) === "ignore") return;
    throw operationError(`Delete target does not exist: ${pointer}`, "POINTER_NOT_FOUND", {
      pointer,
    });
  }
  const before = deleteAt(document, pointer);
  recordChange(changes, "delete", pointer, before, undefined);
}

function applySet(document, operation, base, changes, onlyIfMissing) {
  const pointer = absolute(base, operation.path);
  if (onlyIfMissing && hasAt(document, pointer)) return;
  const before = hasAt(document, pointer) ? deepClone(getAt(document, pointer)) : undefined;
  setAt(document, pointer, deepClone(operation.value), {
    createParents: operation.create_parents ?? true,
    overwrite: operation.overwrite ?? true,
  });
  recordChange(changes, operation.op, pointer, before, operation.value);
}

function applyMapValue(document, operation, base, changes) {
  const pointer = absolute(base, operation.path);
  if (!hasAt(document, pointer)) {
    if (missingBehavior(operation) === "ignore") return;
    throw operationError(`Map target does not exist: ${pointer}`, "POINTER_NOT_FOUND", {
      pointer,
    });
  }
  const before = getAt(document, pointer);
  const match = operation.cases.find((entry) => jsonEqual(entry.from, before));
  if (!match) {
    if ((operation.if_unmapped ?? "error") === "keep") return;
    throw operationError(
      `No map_value case matches ${displayValue(before)} at ${pointer}.`,
      "UNMAPPED_VALUE",
      { pointer, actual: before },
    );
  }
  setAt(document, pointer, deepClone(match.to));
  recordChange(changes, "map_value", pointer, before, match.to);
}

function applyNumber(document, operation, base, changes) {
  const pointer = absolute(base, operation.path);
  if (!hasAt(document, pointer)) {
    if (missingBehavior(operation) === "ignore") return;
    throw operationError(`Number target does not exist: ${pointer}`, "POINTER_NOT_FOUND", {
      pointer,
    });
  }
  const before = getAt(document, pointer);
  if (typeof before !== "number" || !Number.isFinite(before)) {
    throw operationError(`Expected a finite number at ${pointer}.`, "TYPE_MISMATCH", {
      pointer,
      actual: valueType(before),
    });
  }
  let after = before;
  if (operation.multiply !== undefined) after *= operation.multiply;
  if (operation.add !== undefined) after += operation.add;
  if (operation.min !== undefined) after = Math.max(operation.min, after);
  if (operation.max !== undefined) after = Math.min(operation.max, after);
  if (operation.round === "floor") after = Math.floor(after);
  if (operation.round === "ceil") after = Math.ceil(after);
  if (operation.round === "nearest") after = Math.round(after);
  if (!Number.isFinite(after)) {
    throw operationError(`Numeric operation produced a non-finite value at ${pointer}.`, "NUMBER_OVERFLOW");
  }
  setAt(document, pointer, after);
  recordChange(changes, "number", pointer, before, after);
}

function applyForEach(document, operation, base, changes, applyOne) {
  const pointer = absolute(base, operation.path);
  const collection = getAt(document, pointer);
  if (!Array.isArray(collection) && !isPlainObject(collection)) {
    throw operationError(`for_each expects an array or object at ${pointer}.`, "TYPE_MISMATCH", {
      pointer,
      actual: valueType(collection),
    });
  }
  const keys = Array.isArray(collection) ? collection.map((_, index) => index) : Object.keys(collection);
  for (const key of keys) {
    const childBase = `${pointer}/${escapePointerToken(key)}`;
    operation.operations.forEach((child) => applyOne(document, child, childBase, changes));
  }
}

export function applyOperations(document, operations) {
  const output = deepClone(document);
  const changes = [];

  function applyOne(target, operation, base = "", targetChanges = changes) {
    switch (operation.op) {
      case "assert":
        applyAssert(target, operation, base);
        break;
      case "copy":
      case "move":
      case "rename":
        applyTransfer(target, operation, base, targetChanges);
        break;
      case "delete":
        applyDelete(target, operation, base, targetChanges);
        break;
      case "set":
        applySet(target, operation, base, targetChanges, false);
        break;
      case "set_default":
        applySet(target, operation, base, targetChanges, true);
        break;
      case "map_value":
        applyMapValue(target, operation, base, targetChanges);
        break;
      case "number":
        applyNumber(target, operation, base, targetChanges);
        break;
      case "for_each":
        applyForEach(target, operation, base, targetChanges, applyOne);
        break;
      default:
        throw operationError(`Unsupported migration operation: ${operation.op}`, "UNSUPPORTED_OPERATION");
    }
  }

  operations.forEach((operation, index) => {
    try {
      applyOne(output, operation);
    } catch (error) {
      if (error instanceof SaveWeaverError) {
        throw new SaveWeaverError(`Operation ${index + 1} (${operation.op}) failed: ${error.message}`, {
          code: "MIGRATION_OPERATION_FAILED",
          cause: error,
          details: { operationIndex: index, operation, causeCode: error.code },
        });
      }
      throw error;
    }
  });

  return { output, changes };
}
