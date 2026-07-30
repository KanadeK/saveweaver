import { migrateDocument } from "./engine.js";
import { documentVersion } from "./project.js";
import { readJson, relativePosix } from "./util.js";

function failureDetails(error) {
  return {
    code: error?.code ?? "UNEXPECTED_ERROR",
    message: error instanceof Error ? error.message : String(error),
    ...(error?.details ? { details: error.details } : {}),
  };
}

export async function runCompatibilityMatrix(project) {
  const fixtures = [];

  for (const fixturePath of project.fixtureFiles) {
    const relativePath = relativePosix(project.root, fixturePath);
    try {
      const source = await readJson(fixturePath, `fixture ${relativePath}`);
      const sourceVersion = documentVersion(project, source);
      const first = migrateDocument(project, source);
      const second = migrateDocument(project, source);
      if (first.outputHash !== second.outputHash) {
        throw Object.assign(new Error("Migration output is not deterministic."), {
          code: "NONDETERMINISTIC_MIGRATION",
        });
      }
      const idempotent = migrateDocument(project, first.output);
      if (idempotent.outputHash !== first.outputHash || idempotent.steps.length !== 0) {
        throw Object.assign(new Error("Migrating an up-to-date save is not idempotent."), {
          code: "NON_IDEMPOTENT_MIGRATION",
        });
      }
      fixtures.push({
        file: relativePath,
        status: "pass",
        source_version: sourceVersion,
        target_version: first.toVersion,
        migrations: first.steps.map((step) => step.id),
        change_count: first.changes.length,
        source_sha256: first.sourceHash,
        output_sha256: first.outputHash,
        deterministic: true,
        idempotent: true,
      });
    } catch (error) {
      fixtures.push({
        file: relativePath,
        status: "fail",
        error: failureDetails(error),
      });
    }
  }

  const passed = fixtures.filter((fixture) => fixture.status === "pass").length;
  const failed = fixtures.length - passed;
  return {
    format: 1,
    project: project.config.name,
    current_version: project.config.current_version,
    summary: {
      total: fixtures.length,
      passed,
      failed,
      ok: failed === 0,
    },
    fixtures,
  };
}

export function renderMatrixText(report) {
  const lines = [
    `SaveWeaver compatibility matrix: ${report.project} (current v${report.current_version})`,
    "",
  ];
  for (const fixture of report.fixtures) {
    if (fixture.status === "pass") {
      const chain =
        fixture.migrations.length === 0 ? "already current" : fixture.migrations.join(" -> ");
      lines.push(
        `PASS ${fixture.file}  v${fixture.source_version} -> v${fixture.target_version}  ${chain}`,
      );
    } else {
      lines.push(`FAIL ${fixture.file}  [${fixture.error.code}] ${fixture.error.message}`);
    }
  }
  lines.push(
    "",
    `${report.summary.passed}/${report.summary.total} fixtures passed; ${report.summary.failed} failed.`,
  );
  return `${lines.join("\n")}\n`;
}

export function renderMatrixMarkdown(report) {
  const lines = [
    `# SaveWeaver compatibility matrix: ${report.project}`,
    "",
    `Current save version: **v${report.current_version}**`,
    "",
    "| Fixture | Source | Target | Migration chain | Result |",
    "| --- | ---: | ---: | --- | --- |",
  ];
  for (const fixture of report.fixtures) {
    if (fixture.status === "pass") {
      lines.push(
        `| \`${fixture.file}\` | v${fixture.source_version} | v${fixture.target_version} | ${
          fixture.migrations.length === 0
            ? "already current"
            : fixture.migrations.map((item) => `\`${item}\``).join(" → ")
        } | PASS |`,
      );
    } else {
      lines.push(
        `| \`${fixture.file}\` | — | — | \`${fixture.error.code}\` | FAIL |`,
      );
    }
  }
  lines.push(
    "",
    `**${report.summary.passed}/${report.summary.total} passed; ${report.summary.failed} failed.**`,
    "",
    "Each passing row was schema-validated before and after migration, migrated twice to prove deterministic output, and migrated once more to prove current-version idempotency.",
  );
  if (report.summary.failed > 0) {
    lines.push("", "## Failures", "");
    for (const fixture of report.fixtures.filter((entry) => entry.status === "fail")) {
      lines.push(
        `- \`${fixture.file}\`: **${fixture.error.code}** — ${fixture.error.message}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
