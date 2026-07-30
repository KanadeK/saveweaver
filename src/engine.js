import { SaveWeaverError } from "./errors.js";
import { planMigrations } from "./graph.js";
import { setAt } from "./json-pointer.js";
import { applyOperations } from "./operations.js";
import { documentVersion } from "./project.js";
import { validateSchema } from "./schema.js";
import { deepClone, sha256Json } from "./util.js";

function validateAtVersion(project, document, version, phase) {
  const schemaEntry = project.schemas.get(version);
  if (!schemaEntry) {
    if (project.config.policy?.require_all_schemas ?? true) {
      throw new SaveWeaverError(`No schema is configured for version ${version}.`, {
        code: "SCHEMA_MISSING",
        details: { version, phase },
      });
    }
    return [];
  }
  const errors = validateSchema(document, schemaEntry.schema);
  if (errors.length > 0) {
    throw new SaveWeaverError(
      `${phase} save does not satisfy schema v${version} (${errors.length} error${errors.length === 1 ? "" : "s"}).`,
      {
        code: "SCHEMA_VALIDATION_FAILED",
        details: { version, phase, errors },
      },
    );
  }
  return errors;
}

export function migrateDocument(project, sourceDocument, options = {}) {
  const source = deepClone(sourceDocument);
  const fromVersion = documentVersion(project, source);
  const toVersion = options.toVersion ?? project.config.current_version;
  if (toVersion > project.config.current_version) {
    throw new SaveWeaverError(
      `Requested version ${toVersion} exceeds current_version ${project.config.current_version}.`,
      { code: "INVALID_TARGET_VERSION" },
    );
  }

  validateAtVersion(project, source, fromVersion, "Source");
  const plan = planMigrations(project.migrations, fromVersion, toVersion);
  let output = source;
  const steps = [];
  const allChanges = [];

  for (const migration of plan) {
    let applied;
    try {
      applied = applyOperations(output, migration.operations);
    } catch (error) {
      throw new SaveWeaverError(`Migration ${migration.id} failed: ${error.message}`, {
        code: "MIGRATION_FAILED",
        cause: error,
        details: {
          migration: migration.id,
          from: migration.from,
          to: migration.to,
          causeCode: error.code,
          causeDetails: error.details,
        },
      });
    }
    output = applied.output;
    setAt(output, project.config.version_pointer, migration.to, {
      createParents: false,
      overwrite: true,
    });
    validateAtVersion(project, output, migration.to, `After ${migration.id}`);
    const step = {
      id: migration.id,
      from: migration.from,
      to: migration.to,
      migration_hash: migration.hash,
      change_count: applied.changes.length,
    };
    steps.push(step);
    allChanges.push(
      ...applied.changes.map((change) => ({ migration: migration.id, ...change })),
    );
  }

  validateAtVersion(project, output, toVersion, "Target");
  return {
    output,
    fromVersion,
    toVersion,
    steps,
    changes: allChanges,
    sourceHash: sha256Json(sourceDocument),
    outputHash: sha256Json(output),
  };
}
