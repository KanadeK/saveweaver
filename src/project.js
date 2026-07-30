import path from "node:path";

import { SaveWeaverError } from "./errors.js";
import { validateMigrationGraph } from "./graph.js";
import { getAt, parsePointer } from "./json-pointer.js";
import { validateMigrationDefinition } from "./operations.js";
import { checkSchemaSupport } from "./schema.js";
import {
  isPlainObject,
  pathExists,
  readJson,
  relativePosix,
  sha256File,
  walkJsonFiles,
} from "./util.js";

export const CONFIG_FILENAME = "saveweaver.json";

function resolveInside(root, relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new SaveWeaverError(`${label} must be a non-empty relative path.`, {
      code: "INVALID_CONFIG",
    });
  }
  if (path.isAbsolute(relativePath)) {
    throw new SaveWeaverError(`${label} must stay inside the project: ${relativePath}`, {
      code: "PATH_OUTSIDE_PROJECT",
    });
  }
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new SaveWeaverError(`${label} escapes the project root: ${relativePath}`, {
      code: "PATH_OUTSIDE_PROJECT",
    });
  }
  return resolved;
}

function validateConfig(config) {
  const issues = [];
  if (!isPlainObject(config)) return ["Configuration must be an object."];
  if (config.format !== 1) issues.push("format must be 1.");
  if (typeof config.name !== "string" || config.name.trim() === "") {
    issues.push("name must be a non-empty string.");
  }
  if (!Number.isSafeInteger(config.current_version) || config.current_version < 0) {
    issues.push("current_version must be a non-negative integer.");
  }
  try {
    parsePointer(config.version_pointer);
    if (config.version_pointer === "") issues.push("version_pointer cannot target the root.");
  } catch {
    issues.push("version_pointer must be a valid non-root JSON Pointer.");
  }
  if (!isPlainObject(config.schemas) || Object.keys(config.schemas).length === 0) {
    issues.push("schemas must map at least one version to a schema file.");
  }
  if (!Array.isArray(config.migrations)) {
    issues.push("migrations must be an array of migration files.");
  }
  if (!Array.isArray(config.fixture_dirs) || config.fixture_dirs.length === 0) {
    issues.push("fixture_dirs must contain at least one directory.");
  }
  if (
    config.policy !== undefined &&
    (!isPlainObject(config.policy) ||
      Object.values(config.policy).some((value) => typeof value !== "boolean"))
  ) {
    issues.push("policy values must be booleans.");
  }
  return issues;
}

export function documentVersion(project, document) {
  let version;
  try {
    version = getAt(document, project.config.version_pointer);
  } catch (error) {
    throw new SaveWeaverError(
      `Save does not contain version_pointer ${project.config.version_pointer}.`,
      { code: "SAVE_VERSION_MISSING", cause: error },
    );
  }
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new SaveWeaverError(
      `Save version at ${project.config.version_pointer} must be a non-negative integer.`,
      { code: "INVALID_SAVE_VERSION", details: { actual: version } },
    );
  }
  return version;
}

export async function loadProject(projectDirectory) {
  const root = path.resolve(projectDirectory);
  const configPath = path.join(root, CONFIG_FILENAME);
  const config = await readJson(configPath, "SaveWeaver configuration");
  const configIssues = validateConfig(config);
  if (configIssues.length > 0) {
    throw new SaveWeaverError(`Invalid ${CONFIG_FILENAME}: ${configIssues.join(" ")}`, {
      code: "INVALID_CONFIG",
      details: { issues: configIssues },
    });
  }

  const schemas = new Map();
  for (const [rawVersion, relativePath] of Object.entries(config.schemas)) {
    if (!/^(?:0|[1-9]\d*)$/u.test(rawVersion)) {
      throw new SaveWeaverError(`Schema version key must be an integer: ${rawVersion}`, {
        code: "INVALID_CONFIG",
      });
    }
    const version = Number(rawVersion);
    const filePath = resolveInside(root, relativePath, `schemas.${rawVersion}`);
    const schema = await readJson(filePath, `schema v${version}`);
    const supportErrors = checkSchemaSupport(schema);
    if (supportErrors.length > 0) {
      throw new SaveWeaverError(
        `Schema v${version} uses unsupported or invalid keywords.`,
        {
          code: "UNSUPPORTED_SCHEMA",
          details: { file: relativePosix(root, filePath), errors: supportErrors },
        },
      );
    }
    schemas.set(version, {
      version,
      path: filePath,
      relativePath: relativePosix(root, filePath),
      schema,
      hash: await sha256File(filePath),
    });
  }

  if (!schemas.has(config.current_version)) {
    throw new SaveWeaverError(
      `schemas must include current_version ${config.current_version}.`,
      { code: "INVALID_CONFIG" },
    );
  }

  const migrations = [];
  for (const [index, relativePath] of config.migrations.entries()) {
    const filePath = resolveInside(root, relativePath, `migrations[${index}]`);
    const migration = await readJson(filePath, `migration ${relativePath}`);
    const issues = validateMigrationDefinition(migration, relativePath);
    if (issues.length > 0) {
      throw new SaveWeaverError(`Invalid migration ${relativePath}: ${issues.join(" ")}`, {
        code: "INVALID_MIGRATION",
        details: { file: relativePath, issues },
      });
    }
    migrations.push({
      ...migration,
      path: filePath,
      relativePath: relativePosix(root, filePath),
      hash: await sha256File(filePath),
    });
  }

  const graphIssues = validateMigrationGraph(
    migrations,
    [...schemas.keys()],
    config.current_version,
  );
  if (graphIssues.length > 0) {
    throw new SaveWeaverError(`Invalid migration graph: ${graphIssues.join(" ")}`, {
      code: "INVALID_MIGRATION_GRAPH",
      details: { issues: graphIssues },
    });
  }

  const fixtureFiles = [];
  for (const [index, relativePath] of config.fixture_dirs.entries()) {
    const directory = resolveInside(root, relativePath, `fixture_dirs[${index}]`);
    if (!(await pathExists(directory))) {
      throw new SaveWeaverError(`Fixture directory does not exist: ${relativePath}`, {
        code: "FIXTURE_DIRECTORY_MISSING",
      });
    }
    fixtureFiles.push(...(await walkJsonFiles(directory)));
  }
  const uniqueFixtures = [...new Set(fixtureFiles)].sort();
  if (uniqueFixtures.length === 0) {
    throw new SaveWeaverError("No JSON save fixtures were found.", {
      code: "NO_FIXTURES",
    });
  }

  const lockRelativePath = config.lock_file ?? ".saveweaver.lock.json";
  const lockPath = resolveInside(root, lockRelativePath, "lock_file");

  return {
    root,
    configPath,
    config,
    schemas,
    migrations,
    fixtureFiles: uniqueFixtures,
    lockPath,
    lockRelativePath: relativePosix(root, lockPath),
  };
}
