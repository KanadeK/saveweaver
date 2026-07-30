import { getAt } from "./json-pointer.js";
import { canonicalJson, displayValue, isPlainObject } from "./util.js";

const SUPPORTED_KEYS = new Set([
  "$comment",
  "$defs",
  "$id",
  "$ref",
  "$schema",
  "additionalProperties",
  "allOf",
  "anyOf",
  "const",
  "default",
  "deprecated",
  "description",
  "enum",
  "examples",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "items",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "not",
  "oneOf",
  "pattern",
  "properties",
  "readOnly",
  "required",
  "title",
  "type",
  "uniqueItems",
  "writeOnly",
]);

function schemaPath(parent, token) {
  const escaped = String(token).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${parent}/${escaped}`;
}

export function checkSchemaSupport(schema) {
  const errors = [];

  function visit(current, at) {
    if (typeof current === "boolean") {
      return;
    }
    if (!isPlainObject(current)) {
      errors.push({
        path: at,
        keyword: "schema",
        message: "A schema must be an object or boolean.",
      });
      return;
    }

    for (const key of Object.keys(current)) {
      if (!SUPPORTED_KEYS.has(key)) {
        errors.push({
          path: schemaPath(at, key),
          keyword: "unsupported",
          message: `Unsupported schema keyword: ${key}`,
        });
      }
    }

    for (const keyword of ["properties", "$defs"]) {
      if (current[keyword] !== undefined) {
        if (!isPlainObject(current[keyword])) {
          errors.push({
            path: schemaPath(at, keyword),
            keyword,
            message: `${keyword} must be an object.`,
          });
        } else {
          for (const [name, child] of Object.entries(current[keyword])) {
            visit(child, schemaPath(schemaPath(at, keyword), name));
          }
        }
      }
    }

    for (const keyword of ["additionalProperties", "items", "not"]) {
      if (current[keyword] !== undefined) {
        visit(current[keyword], schemaPath(at, keyword));
      }
    }

    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      if (current[keyword] !== undefined) {
        if (!Array.isArray(current[keyword])) {
          errors.push({
            path: schemaPath(at, keyword),
            keyword,
            message: `${keyword} must be an array.`,
          });
        } else {
          current[keyword].forEach((child, index) =>
            visit(child, schemaPath(schemaPath(at, keyword), index)),
          );
        }
      }
    }

    if (current.$ref !== undefined) {
      if (typeof current.$ref !== "string" || !current.$ref.startsWith("#")) {
        errors.push({
          path: schemaPath(at, "$ref"),
          keyword: "$ref",
          message: "Only local $ref values beginning with # are supported.",
        });
      }
    }
  }

  visit(schema, "#");
  return errors;
}

function actualType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, expected) {
  if (expected === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (expected === "integer") {
    return Number.isInteger(value);
  }
  if (expected === "object") {
    return isPlainObject(value);
  }
  return actualType(value) === expected;
}

function equalJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function addError(errors, path, keyword, message, expected, actual) {
  errors.push({
    path,
    keyword,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  });
}

function resolveReference(root, reference) {
  if (reference === "#") {
    return root;
  }
  return getAt(root, reference.slice(1));
}

export function validateSchema(value, schema) {
  const supportErrors = checkSchemaSupport(schema);
  if (supportErrors.length > 0) {
    return supportErrors;
  }

  const errors = [];

  function validate(current, currentSchema, at, referenceStack = []) {
    if (currentSchema === true) return;
    if (currentSchema === false) {
      addError(errors, at, "falseSchema", "Value is rejected by a false schema.");
      return;
    }

    if (currentSchema.$ref !== undefined) {
      if (referenceStack.includes(currentSchema.$ref)) {
        addError(
          errors,
          at,
          "$ref",
          `Circular local schema reference: ${currentSchema.$ref}`,
        );
        return;
      }
      let target;
      try {
        target = resolveReference(schema, currentSchema.$ref);
      } catch {
        addError(errors, at, "$ref", `Unresolved schema reference: ${currentSchema.$ref}`);
        return;
      }
      validate(current, target, at, [...referenceStack, currentSchema.$ref]);
    }

    const matchesBranch = (child) => {
      const previousLength = errors.length;
      validate(current, child, at, referenceStack);
      const matches = errors.length === previousLength;
      errors.length = previousLength;
      return matches;
    };

    if (currentSchema.allOf) {
      for (const child of currentSchema.allOf) validate(current, child, at, referenceStack);
    }
    if (currentSchema.anyOf) {
      const matches = currentSchema.anyOf.filter(matchesBranch).length;
      if (matches === 0) {
        addError(errors, at, "anyOf", "Value does not match any allowed schema.");
      }
    }
    if (currentSchema.oneOf) {
      const matches = currentSchema.oneOf.filter(matchesBranch).length;
      if (matches !== 1) {
        addError(errors, at, "oneOf", `Value matches ${matches} schemas; expected exactly 1.`);
      }
    }
    if (currentSchema.not && matchesBranch(currentSchema.not)) {
      addError(errors, at, "not", "Value matches a forbidden schema.");
    }

    if (currentSchema.const !== undefined && !equalJson(current, currentSchema.const)) {
      addError(
        errors,
        at,
        "const",
        `Expected ${displayValue(currentSchema.const)}.`,
        currentSchema.const,
        current,
      );
    }
    if (
      currentSchema.enum &&
      !currentSchema.enum.some((candidate) => equalJson(current, candidate))
    ) {
      addError(errors, at, "enum", "Value is not in the allowed set.", currentSchema.enum, current);
    }

    if (currentSchema.type !== undefined) {
      const expected = Array.isArray(currentSchema.type)
        ? currentSchema.type
        : [currentSchema.type];
      if (!expected.some((candidate) => matchesType(current, candidate))) {
        addError(
          errors,
          at,
          "type",
          `Expected ${expected.join(" or ")}, received ${actualType(current)}.`,
          expected,
          actualType(current),
        );
        return;
      }
    }

    if (typeof current === "number" && Number.isFinite(current)) {
      const comparisons = [
        ["minimum", (limit) => current >= limit, ">="],
        ["maximum", (limit) => current <= limit, "<="],
        ["exclusiveMinimum", (limit) => current > limit, ">"],
        ["exclusiveMaximum", (limit) => current < limit, "<"],
      ];
      for (const [keyword, predicate, symbol] of comparisons) {
        if (currentSchema[keyword] !== undefined && !predicate(currentSchema[keyword])) {
          addError(
            errors,
            at,
            keyword,
            `Expected number ${symbol} ${currentSchema[keyword]}.`,
            currentSchema[keyword],
            current,
          );
        }
      }
      if (
        currentSchema.multipleOf !== undefined &&
        Math.abs(current / currentSchema.multipleOf - Math.round(current / currentSchema.multipleOf)) >
          Number.EPSILON * 10
      ) {
        addError(
          errors,
          at,
          "multipleOf",
          `Expected a multiple of ${currentSchema.multipleOf}.`,
          currentSchema.multipleOf,
          current,
        );
      }
    }

    if (typeof current === "string") {
      if (currentSchema.minLength !== undefined && current.length < currentSchema.minLength) {
        addError(errors, at, "minLength", `Expected at least ${currentSchema.minLength} characters.`);
      }
      if (currentSchema.maxLength !== undefined && current.length > currentSchema.maxLength) {
        addError(errors, at, "maxLength", `Expected at most ${currentSchema.maxLength} characters.`);
      }
      if (currentSchema.pattern !== undefined) {
        let expression;
        try {
          expression = new RegExp(currentSchema.pattern, "u");
        } catch {
          addError(errors, at, "pattern", `Invalid regular expression: ${currentSchema.pattern}`);
          expression = null;
        }
        if (expression && !expression.test(current)) {
          addError(errors, at, "pattern", `String does not match /${currentSchema.pattern}/u.`);
        }
      }
    }

    if (Array.isArray(current)) {
      if (currentSchema.minItems !== undefined && current.length < currentSchema.minItems) {
        addError(errors, at, "minItems", `Expected at least ${currentSchema.minItems} items.`);
      }
      if (currentSchema.maxItems !== undefined && current.length > currentSchema.maxItems) {
        addError(errors, at, "maxItems", `Expected at most ${currentSchema.maxItems} items.`);
      }
      if (currentSchema.uniqueItems) {
        const values = current.map((item) => canonicalJson(item));
        if (new Set(values).size !== values.length) {
          addError(errors, at, "uniqueItems", "Array items must be unique.");
        }
      }
      if (currentSchema.items !== undefined) {
        current.forEach((item, index) =>
          validate(item, currentSchema.items, `${at}/${index}`, referenceStack),
        );
      }
    }

    if (isPlainObject(current)) {
      const keys = Object.keys(current);
      if (
        currentSchema.minProperties !== undefined &&
        keys.length < currentSchema.minProperties
      ) {
        addError(
          errors,
          at,
          "minProperties",
          `Expected at least ${currentSchema.minProperties} properties.`,
        );
      }
      if (
        currentSchema.maxProperties !== undefined &&
        keys.length > currentSchema.maxProperties
      ) {
        addError(
          errors,
          at,
          "maxProperties",
          `Expected at most ${currentSchema.maxProperties} properties.`,
        );
      }
      for (const required of currentSchema.required ?? []) {
        if (!Object.prototype.hasOwnProperty.call(current, required)) {
          addError(errors, `${at}/${required}`, "required", `Missing required property: ${required}`);
        }
      }
      const properties = currentSchema.properties ?? {};
      for (const [key, child] of Object.entries(properties)) {
        if (Object.prototype.hasOwnProperty.call(current, key)) {
          validate(current[key], child, `${at}/${key}`, referenceStack);
        }
      }
      const extras = keys.filter(
        (key) => !Object.prototype.hasOwnProperty.call(properties, key),
      );
      if (currentSchema.additionalProperties === false) {
        for (const key of extras) {
          addError(errors, `${at}/${key}`, "additionalProperties", `Unexpected property: ${key}`);
        }
      } else if (isPlainObject(currentSchema.additionalProperties)) {
        for (const key of extras) {
          validate(current[key], currentSchema.additionalProperties, `${at}/${key}`, referenceStack);
        }
      }
    }
  }

  validate(value, schema, "");
  return errors;
}
