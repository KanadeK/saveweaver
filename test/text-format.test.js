import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectTextFormat,
  normalizeWindowsLauncher,
} from "../scripts/lib/text-format.mjs";

test("Windows launchers accept either clean CRLF or LF checkouts", () => {
  const options = { extension: ".cmd", relative: "portable/saveweaver.cmd" };
  assert.deepEqual(inspectTextFormat("@echo off\r\nnode app.js\r\n", options), []);
  assert.deepEqual(inspectTextFormat("@echo off\nnode app.js\n", options), []);
  assert.equal(
    normalizeWindowsLauncher("@echo off\nnode app.js\n"),
    "@echo off\r\nnode app.js\r\n",
  );
  assert.equal(
    normalizeWindowsLauncher("@echo off\r\nnode app.js\r\n"),
    "@echo off\r\nnode app.js\r\n",
  );
});

test("non-Windows text files still require LF", () => {
  const issues = inspectTextFormat("const answer = 42;\r\n", {
    extension: ".js",
    relative: "src/example.js",
  });
  assert.deepEqual(issues, ["src/example.js: use LF line endings"]);
});

test("Windows launchers reject mixed or malformed carriage returns", () => {
  const options = { extension: ".cmd", relative: "portable/saveweaver.cmd" };
  assert.deepEqual(inspectTextFormat("@echo off\r\nnode app.js\n", options), [
    "portable/saveweaver.cmd: mixed LF and CRLF line endings",
  ]);
  assert.deepEqual(inspectTextFormat("@echo off\rnode app.js\n", options), [
    "portable/saveweaver.cmd: unsupported carriage return",
  ]);
});

test("format diagnostics cover BOM, final newline, and trailing whitespace", () => {
  assert.deepEqual(
    inspectTextFormat("\ufeffconst answer = 42; \nexport { answer };", {
      extension: ".js",
      relative: "src/example.js",
    }),
    [
      "src/example.js: UTF-8 BOM is not allowed",
      "src/example.js: missing final newline",
      "src/example.js:1: trailing whitespace",
    ],
  );
});
