import { constants as fsConstants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { diffJson } from "./diff.js";
import { migrateDocument } from "./engine.js";
import { asSaveWeaverError, SaveWeaverError } from "./errors.js";
import { checkLock, createLock } from "./lock.js";
import {
  renderMatrixMarkdown,
  renderMatrixText,
  runCompatibilityMatrix,
} from "./matrix.js";
import { loadProject } from "./project.js";
import { createReceipt, verifyReceipt } from "./receipt.js";
import { scaffoldProject } from "./scaffold.js";
import { diffSchemas } from "./schema-diff.js";
import {
  canonicalJson,
  pathExists,
  readJson,
  writeJsonAtomic,
  writeTextAtomic,
} from "./util.js";
import { PACKAGE_VERSION } from "./version.js";

const HELP = `SaveWeaver ${PACKAGE_VERSION}

CI for the save files your players already have.

Usage:
  saveweaver init [directory]
  saveweaver check [--project directory] [--format text|json]
  saveweaver matrix [--project directory] [--format text|json|markdown] [--out file]
  saveweaver migrate <save.json> [--project directory] (--out file | --in-place | --dry-run)
  saveweaver plan <save.json> [--project directory] [--to version] [--format text|json]
  saveweaver lock [--project directory] [--check]
  saveweaver schema-diff <old.schema.json> <new.schema.json> [--format text|json]
  saveweaver verify-receipt <receipt.json> <output-save.json>
  saveweaver --version

Safety defaults:
  migrate never overwrites the input unless --in-place is explicit. In-place
  migration writes a content-addressed backup first. Successful writes use an
  atomic temporary-file rename and emit a SHA-256 receipt. A separate existing
  output also requires --overwrite.
`;

function parseArguments(arguments_) {
  const positional = [];
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const token = arguments_[index];
    if (token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "-v") {
      options.version = true;
      continue;
    }
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    if (equals !== -1) {
      options[token.slice(2, equals).replaceAll("-", "_")] = token.slice(equals + 1);
      continue;
    }
    const key = token.slice(2).replaceAll("-", "_");
    const next = arguments_[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { positional, options };
}

function usageError(message) {
  return new SaveWeaverError(message, { code: "USAGE_ERROR", exitCode: 2 });
}

function numericOption(value, name) {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9]\d*)$/u.test(String(value))) {
    throw usageError(`${name} must be a non-negative integer.`);
  }
  return Number(value);
}

function output(stream, value) {
  stream.write(value.endsWith("\n") ? value : `${value}\n`);
}

function projectDirectory(context, options) {
  return path.resolve(context.cwd, options.project ?? ".");
}

async function commandInit(context, positional) {
  const target = path.resolve(context.cwd, positional[0] ?? ".");
  const project = await scaffoldProject(target);
  output(context.stdout, `Initialized SaveWeaver project at ${project.root}`);
  output(context.stdout, `Fixture: ${path.relative(project.root, project.fixtureFiles[0])}`);
  output(context.stdout, "Next: saveweaver check");
  return 0;
}

async function commandMatrix(context, options) {
  const project = await loadProject(projectDirectory(context, options));
  const report = await runCompatibilityMatrix(project);
  const format = options.format ?? "text";
  let rendered;
  if (format === "json") rendered = canonicalJson(report);
  else if (format === "markdown") rendered = renderMatrixMarkdown(report);
  else if (format === "text") rendered = renderMatrixText(report);
  else throw usageError("--format must be text, json, or markdown.");

  if (options.out) {
    const destination = path.resolve(context.cwd, options.out);
    await writeTextAtomic(destination, rendered);
    output(context.stdout, `Wrote ${format} matrix report to ${destination}`);
  } else {
    output(context.stdout, rendered);
  }
  return report.summary.ok ? 0 : 1;
}

async function commandCheck(context, options) {
  const project = await loadProject(projectDirectory(context, options));
  const lockResult = await checkLock(project);
  const matrix = await runCompatibilityMatrix(project);
  const result = {
    ok: lockResult.ok && matrix.summary.ok,
    project: project.config.name,
    current_version: project.config.current_version,
    contract_lock: {
      ok: lockResult.ok,
      issues: lockResult.issues,
    },
    compatibility_matrix: matrix.summary,
  };
  if ((options.format ?? "text") === "json") {
    output(context.stdout, canonicalJson(result));
  } else {
    output(context.stdout, `SaveWeaver check: ${result.project} (v${result.current_version})`);
    output(
      context.stdout,
      `${lockResult.ok ? "PASS" : "FAIL"} contract lock${
        lockResult.ok ? "" : `: ${lockResult.issues.join("; ")}`
      }`,
    );
    output(
      context.stdout,
      `${matrix.summary.ok ? "PASS" : "FAIL"} compatibility matrix: ${matrix.summary.passed}/${matrix.summary.total}`,
    );
    output(context.stdout, result.ok ? "PASS project is release-ready." : "FAIL project check failed.");
  }
  return result.ok ? 0 : 1;
}

async function commandLock(context, options) {
  const project = await loadProject(projectDirectory(context, options));
  if (options.check) {
    const result = await checkLock(project);
    if (result.ok) {
      output(context.stdout, `PASS ${project.lockRelativePath} matches all contract files.`);
      return 0;
    }
    output(context.stderr, `FAIL ${result.issues.join("; ")}`);
    return 1;
  }
  const lock = await createLock(project);
  await writeJsonAtomic(project.lockPath, lock);
  output(context.stdout, `Wrote ${project.lockPath}`);
  return 0;
}

function renderPlan(sourcePath, result, diff) {
  const lines = [
    `${sourcePath}: v${result.fromVersion} -> v${result.toVersion}`,
    result.steps.length === 0
      ? "No migrations required."
      : `Plan: ${result.steps.map((step) => `${step.id} (${step.from}->${step.to})`).join(" -> ")}`,
    `Structural changes: ${diff.changes.length}${diff.truncated ? "+" : ""}`,
  ];
  for (const change of diff.changes.slice(0, 30)) {
    lines.push(`  ${change.kind.toUpperCase()} ${change.path || "/"}`);
  }
  return `${lines.join("\n")}\n`;
}

async function loadMigrationResult(context, positional, options) {
  if (!positional[0]) throw usageError("A save JSON path is required.");
  const project = await loadProject(projectDirectory(context, options));
  const sourcePath = path.resolve(context.cwd, positional[0]);
  const source = await readJson(sourcePath, "source save");
  const toVersion = numericOption(options.to, "--to");
  const result = migrateDocument(project, source, { toVersion });
  const diff = diffJson(source, result.output);
  return { project, sourcePath, source, result, diff };
}

async function commandPlan(context, positional, options) {
  const { sourcePath, result, diff } = await loadMigrationResult(
    context,
    positional,
    options,
  );
  if ((options.format ?? "text") === "json") {
    output(
      context.stdout,
      canonicalJson({
        source: sourcePath,
        from_version: result.fromVersion,
        to_version: result.toVersion,
        steps: result.steps,
        diff,
        output_sha256: result.outputHash,
      }),
    );
  } else {
    output(context.stdout, renderPlan(sourcePath, result, diff));
  }
  return 0;
}

async function commandMigrate(context, positional, options) {
  const modes = [Boolean(options.out), Boolean(options.in_place), Boolean(options.dry_run)].filter(
    Boolean,
  ).length;
  if (modes !== 1) {
    throw usageError("Choose exactly one of --out, --in-place, or --dry-run.");
  }
  const loaded = await loadMigrationResult(context, positional, options);
  const { project, sourcePath, result, diff } = loaded;
  if (options.dry_run) {
    output(context.stdout, renderPlan(sourcePath, result, diff));
    output(context.stdout, "Dry run: no files were written.");
    return 0;
  }

  let destination;
  let backupPath = null;
  if (options.in_place) {
    destination = sourcePath;
    const backupDirectory = path.join(path.dirname(sourcePath), ".saveweaver-backups");
    await mkdir(backupDirectory, { recursive: true });
    backupPath = path.join(
      backupDirectory,
      `${path.basename(sourcePath)}.${result.sourceHash.slice(0, 12)}.bak`,
    );
    if (!(await pathExists(backupPath))) {
      await copyFile(sourcePath, backupPath, fsConstants.COPYFILE_EXCL);
    }
  } else {
    destination = path.resolve(context.cwd, options.out);
    if (destination === sourcePath) {
      throw usageError("Use --in-place when the output path is the input path.");
    }
    if ((await pathExists(destination)) && !options.overwrite) {
      throw new SaveWeaverError(
        `Output already exists: ${destination}. Pass --overwrite to replace it.`,
        { code: "OUTPUT_EXISTS" },
      );
    }
  }

  await writeJsonAtomic(destination, result.output);
  const receipt = createReceipt(project, sourcePath, result);
  const receiptPath = options.receipt
    ? path.resolve(context.cwd, options.receipt)
    : `${destination}.saveweaver-receipt.json`;
  await writeJsonAtomic(receiptPath, receipt);
  output(context.stdout, `Migrated v${result.fromVersion} -> v${result.toVersion}: ${destination}`);
  if (backupPath) output(context.stdout, `Backup: ${backupPath}`);
  output(context.stdout, `Receipt: ${receiptPath}`);
  output(context.stdout, `SHA-256: ${result.outputHash}`);
  return 0;
}

async function commandSchemaDiff(context, positional, options) {
  if (!positional[0] || !positional[1]) {
    throw usageError("schema-diff requires old and new schema paths.");
  }
  const before = await readJson(path.resolve(context.cwd, positional[0]), "old schema");
  const after = await readJson(path.resolve(context.cwd, positional[1]), "new schema");
  const report = diffSchemas(before, after);
  if ((options.format ?? "text") === "json") {
    output(context.stdout, canonicalJson(report));
  } else {
    if (report.changes.length === 0) output(context.stdout, "No compatibility changes detected.");
    for (const change of report.changes) {
      output(
        context.stdout,
        `${change.severity.toUpperCase()} ${change.path || "/"} ${change.kind}: ${change.message}`,
      );
    }
    output(
      context.stdout,
      `${report.breaking.length} breaking, ${report.warnings.length} warning, ${report.changes.length} total.`,
    );
  }
  return report.breaking.length === 0 ? 0 : 1;
}

async function commandVerifyReceipt(context, positional) {
  if (!positional[0] || !positional[1]) {
    throw usageError("verify-receipt requires a receipt and output save path.");
  }
  const receipt = await readJson(path.resolve(context.cwd, positional[0]), "migration receipt");
  const outputDocument = await readJson(path.resolve(context.cwd, positional[1]), "output save");
  const result = verifyReceipt(receipt, outputDocument);
  if (result.ok) {
    output(context.stdout, `PASS output hash matches receipt: ${result.actualHash}`);
    return 0;
  }
  output(context.stderr, `FAIL ${result.issues.join("; ")}`);
  return 1;
}

export async function runCli(arguments_, providedContext = {}) {
  const context = {
    cwd: providedContext.cwd ?? process.cwd(),
    stdout: providedContext.stdout ?? process.stdout,
    stderr: providedContext.stderr ?? process.stderr,
  };
  const { positional, options } = parseArguments(arguments_);
  const command = positional.shift();

  try {
    if (options.version || command === "version") {
      output(context.stdout, PACKAGE_VERSION);
      return 0;
    }
    if (options.help || command === undefined || command === "help") {
      output(context.stdout, HELP);
      return 0;
    }
    switch (command) {
      case "init":
        return await commandInit(context, positional, options);
      case "check":
        return await commandCheck(context, options);
      case "matrix":
        return await commandMatrix(context, options);
      case "lock":
        return await commandLock(context, options);
      case "plan":
        return await commandPlan(context, positional, options);
      case "migrate":
        return await commandMigrate(context, positional, options);
      case "schema-diff":
        return await commandSchemaDiff(context, positional, options);
      case "verify-receipt":
        return await commandVerifyReceipt(context, positional);
      default:
        throw usageError(`Unknown command: ${command}`);
    }
  } catch (error) {
    const normalized = asSaveWeaverError(error);
    if ((options.format ?? "text") === "json") {
      output(
        context.stderr,
        canonicalJson({
          ok: false,
          error: {
            code: normalized.code,
            message: normalized.message,
            ...(normalized.details ? { details: normalized.details } : {}),
          },
        }),
      );
    } else {
      output(context.stderr, `ERROR [${normalized.code}] ${normalized.message}`);
      if (normalized.details?.errors) {
        for (const detail of normalized.details.errors.slice(0, 20)) {
          output(
            context.stderr,
            `  ${detail.path || "/"} ${detail.keyword}: ${detail.message}`,
          );
        }
      }
    }
    return normalized.exitCode;
  }
}
