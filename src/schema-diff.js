import { escapePointerToken } from "./json-pointer.js";

function typeSet(schema) {
  if (schema.type === undefined) return null;
  return new Set(Array.isArray(schema.type) ? schema.type : [schema.type]);
}

export function diffSchemas(previous, next) {
  const changes = [];

  function add(path, kind, severity, message) {
    changes.push({ path, kind, severity, message });
  }

  function visit(before, after, pointer) {
    if (typeof before === "boolean" || typeof after === "boolean") {
      if (before === true && after === false) {
        add(pointer, "schema_rejects_all", "breaking", "Schema changed from allow-all to reject-all.");
      }
      return;
    }

    const beforeTypes = typeSet(before);
    const afterTypes = typeSet(after);
    if (beforeTypes && afterTypes) {
      const removed = [...beforeTypes].filter((type) => !afterTypes.has(type));
      if (removed.length > 0) {
        add(
          pointer,
          "type_narrowed",
          "breaking",
          `Allowed type${removed.length === 1 ? "" : "s"} removed: ${removed.join(", ")}.`,
        );
      }
    }

    const beforeRequired = new Set(before.required ?? []);
    const afterRequired = new Set(after.required ?? []);
    for (const property of afterRequired) {
      if (!beforeRequired.has(property)) {
        add(
          `${pointer}/${escapePointerToken(property)}`,
          "required_added",
          "breaking",
          `Property became required: ${property}.`,
        );
      }
    }

    if (Array.isArray(before.enum) && Array.isArray(after.enum)) {
      const removed = before.enum.filter(
        (value) => !after.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value)),
      );
      if (removed.length > 0) {
        add(pointer, "enum_narrowed", "breaking", `${removed.length} enum value(s) were removed.`);
      }
    }

    const bounds = [
      ["minimum", (left, right) => right > left, "Minimum increased"],
      ["exclusiveMinimum", (left, right) => right > left, "Exclusive minimum increased"],
      ["maximum", (left, right) => right < left, "Maximum decreased"],
      ["exclusiveMaximum", (left, right) => right < left, "Exclusive maximum decreased"],
      ["minLength", (left, right) => right > left, "Minimum length increased"],
      ["maxLength", (left, right) => right < left, "Maximum length decreased"],
      ["minItems", (left, right) => right > left, "Minimum item count increased"],
      ["maxItems", (left, right) => right < left, "Maximum item count decreased"],
    ];
    for (const [keyword, isBreaking, label] of bounds) {
      if (
        before[keyword] !== undefined &&
        after[keyword] !== undefined &&
        isBreaking(before[keyword], after[keyword])
      ) {
        add(
          pointer,
          `${keyword}_tightened`,
          "breaking",
          `${label}: ${before[keyword]} -> ${after[keyword]}.`,
        );
      }
    }

    if (before.additionalProperties !== false && after.additionalProperties === false) {
      add(
        pointer,
        "additional_properties_forbidden",
        "breaking",
        "Unknown properties are now forbidden.",
      );
    }

    const beforeProperties = before.properties ?? {};
    const afterProperties = after.properties ?? {};
    for (const [name, child] of Object.entries(beforeProperties)) {
      const childPointer = `${pointer}/${escapePointerToken(name)}`;
      if (!Object.hasOwn(afterProperties, name)) {
        add(childPointer, "property_removed", "warning", `Documented property removed: ${name}.`);
      } else {
        visit(child, afterProperties[name], childPointer);
      }
    }
    for (const name of Object.keys(afterProperties)) {
      if (!Object.hasOwn(beforeProperties, name)) {
        add(
          `${pointer}/${escapePointerToken(name)}`,
          "property_added",
          afterRequired.has(name) ? "breaking" : "info",
          `Property added: ${name}.`,
        );
      }
    }

    if (before.items && after.items) visit(before.items, after.items, `${pointer}/*`);
  }

  visit(previous, next, "");
  return {
    breaking: changes.filter((change) => change.severity === "breaking"),
    warnings: changes.filter((change) => change.severity === "warning"),
    changes,
  };
}
