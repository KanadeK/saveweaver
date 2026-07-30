import { escapePointerToken } from "./json-pointer.js";
import { canonicalJson, deepClone, isPlainObject } from "./util.js";

function equalJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export function diffJson(before, after, { limit = 500 } = {}) {
  const changes = [];

  function visit(left, right, pointer) {
    if (changes.length >= limit || equalJson(left, right)) return;

    if (Array.isArray(left) && Array.isArray(right)) {
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) {
        const child = `${pointer}/${index}`;
        if (index >= left.length) {
          changes.push({ path: child, kind: "added", after: deepClone(right[index]) });
        } else if (index >= right.length) {
          changes.push({ path: child, kind: "removed", before: deepClone(left[index]) });
        } else {
          visit(left[index], right[index], child);
        }
        if (changes.length >= limit) return;
      }
      return;
    }

    if (isPlainObject(left) && isPlainObject(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      for (const key of keys) {
        const child = `${pointer}/${escapePointerToken(key)}`;
        if (!Object.hasOwn(left, key)) {
          changes.push({ path: child, kind: "added", after: deepClone(right[key]) });
        } else if (!Object.hasOwn(right, key)) {
          changes.push({ path: child, kind: "removed", before: deepClone(left[key]) });
        } else {
          visit(left[key], right[key], child);
        }
        if (changes.length >= limit) return;
      }
      return;
    }

    changes.push({
      path: pointer,
      kind: "changed",
      before: deepClone(left),
      after: deepClone(right),
    });
  }

  visit(before, after, "");
  return { changes, truncated: changes.length >= limit };
}
