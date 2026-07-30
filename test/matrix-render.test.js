import assert from "node:assert/strict";
import test from "node:test";

import {
  renderMatrixMarkdown,
  renderMatrixText,
} from "../src/matrix.js";

const mixedReport = {
  project: "test-game",
  current_version: 3,
  summary: { total: 2, passed: 1, failed: 1, ok: false },
  fixtures: [
    {
      file: "fixtures/v1/good.json",
      status: "pass",
      source_version: 1,
      target_version: 3,
      migrations: ["one-two", "two-three"],
    },
    {
      file: "fixtures/v2/bad.json",
      status: "fail",
      error: { code: "SCHEMA_VALIDATION_FAILED", message: "Missing wallet." },
    },
  ],
};

test("text matrix rendering includes passing chains and actionable failures", () => {
  const output = renderMatrixText(mixedReport);
  assert.match(output, /PASS fixtures\/v1\/good\.json/);
  assert.match(output, /one-two -> two-three/);
  assert.match(output, /FAIL fixtures\/v2\/bad\.json/);
  assert.match(output, /1\/2 fixtures passed/);
});

test("Markdown matrix rendering produces a table and failure section", () => {
  const output = renderMatrixMarkdown(mixedReport);
  assert.match(output, /# SaveWeaver compatibility matrix/);
  assert.match(output, /\| `fixtures\/v1\/good\.json`/);
  assert.match(output, /## Failures/);
  assert.match(output, /Missing wallet/);
});

test("renderers describe a current-version fixture without a migration chain", () => {
  const report = {
    project: "current",
    current_version: 1,
    summary: { total: 1, passed: 1, failed: 0, ok: true },
    fixtures: [
      {
        file: "fixtures/current.json",
        status: "pass",
        source_version: 1,
        target_version: 1,
        migrations: [],
      },
    ],
  };
  assert.match(renderMatrixText(report), /already current/);
  assert.match(renderMatrixMarkdown(report), /already current/);
  assert.doesNotMatch(renderMatrixMarkdown(report), /## Failures/);
});
