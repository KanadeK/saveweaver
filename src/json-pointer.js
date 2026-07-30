import { SaveWeaverError } from "./errors.js";

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function escapePointerToken(token) {
  return String(token).replaceAll("~", "~0").replaceAll("/", "~1");
}

export function unescapePointerToken(token) {
  if (/~(?:[^01]|$)/u.test(token)) {
    throw new SaveWeaverError(`Invalid JSON Pointer escape in token: ${token}`, {
      code: "INVALID_POINTER",
    });
  }
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function parsePointer(pointer) {
  if (pointer === "") {
    return [];
  }
  if (typeof pointer !== "string" || !pointer.startsWith("/")) {
    throw new SaveWeaverError(`JSON Pointer must be empty or start with "/": ${pointer}`, {
      code: "INVALID_POINTER",
    });
  }
  return pointer.slice(1).split("/").map(unescapePointerToken);
}

function arrayIndex(token, length, allowAppend = false) {
  if (allowAppend && token === "-") {
    return length;
  }
  if (!/^(?:0|[1-9]\d*)$/u.test(token)) {
    throw new SaveWeaverError(`Invalid array index in JSON Pointer: ${token}`, {
      code: "INVALID_POINTER_INDEX",
    });
  }
  const index = Number(token);
  if (!Number.isSafeInteger(index) || index >= length) {
    throw new SaveWeaverError(`Array index is out of bounds: ${token}`, {
      code: "POINTER_NOT_FOUND",
    });
  }
  return index;
}

export function hasAt(document, pointer) {
  try {
    getAt(document, pointer);
    return true;
  } catch (error) {
    if (error instanceof SaveWeaverError && error.code === "POINTER_NOT_FOUND") {
      return false;
    }
    throw error;
  }
}

export function getAt(document, pointer) {
  let current = document;
  for (const token of parsePointer(pointer)) {
    if (Array.isArray(current)) {
      current = current[arrayIndex(token, current.length)];
      continue;
    }
    if (current !== null && typeof current === "object" && own(current, token)) {
      current = current[token];
      continue;
    }
    throw new SaveWeaverError(`JSON Pointer does not exist: ${pointer}`, {
      code: "POINTER_NOT_FOUND",
      details: { pointer },
    });
  }
  return current;
}

function parentAt(document, pointer, createParents) {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    throw new SaveWeaverError("An operation cannot target the document root", {
      code: "ROOT_POINTER_NOT_ALLOWED",
    });
  }

  let current = document;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current)) {
      current = current[arrayIndex(token, current.length)];
      continue;
    }
    if (current === null || typeof current !== "object") {
      throw new SaveWeaverError(`Cannot traverse through a scalar at ${pointer}`, {
        code: "POINTER_NOT_FOUND",
      });
    }
    if (!own(current, token)) {
      if (!createParents) {
        throw new SaveWeaverError(`JSON Pointer parent does not exist: ${pointer}`, {
          code: "POINTER_NOT_FOUND",
        });
      }
      current[token] = {};
    }
    current = current[token];
  }

  return { parent: current, token: tokens.at(-1) };
}

export function setAt(
  document,
  pointer,
  value,
  { createParents = false, overwrite = true } = {},
) {
  const { parent, token } = parentAt(document, pointer, createParents);

  if (Array.isArray(parent)) {
    const index =
      token === "-" ? parent.length : arrayIndex(token, parent.length, true);
    if (!overwrite && index < parent.length) {
      throw new SaveWeaverError(`Destination already exists: ${pointer}`, {
        code: "DESTINATION_EXISTS",
      });
    }
    if (index === parent.length) {
      parent.push(value);
    } else {
      parent[index] = value;
    }
    return;
  }

  if (parent === null || typeof parent !== "object") {
    throw new SaveWeaverError(`Cannot write through a scalar at ${pointer}`, {
      code: "POINTER_NOT_FOUND",
    });
  }
  if (!overwrite && own(parent, token)) {
    throw new SaveWeaverError(`Destination already exists: ${pointer}`, {
      code: "DESTINATION_EXISTS",
    });
  }
  parent[token] = value;
}

export function deleteAt(document, pointer) {
  const { parent, token } = parentAt(document, pointer, false);
  if (Array.isArray(parent)) {
    const index = arrayIndex(token, parent.length);
    return parent.splice(index, 1)[0];
  }
  if (parent !== null && typeof parent === "object" && own(parent, token)) {
    const value = parent[token];
    delete parent[token];
    return value;
  }
  throw new SaveWeaverError(`JSON Pointer does not exist: ${pointer}`, {
    code: "POINTER_NOT_FOUND",
    details: { pointer },
  });
}

export function joinPointer(base, relative) {
  parsePointer(base);
  parsePointer(relative);
  if (base === "") {
    return relative;
  }
  if (relative === "") {
    return base;
  }
  return `${base}${relative}`;
}
