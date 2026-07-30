import { SaveWeaverError } from "./errors.js";

export function validateMigrationGraph(migrations, versions, currentVersion) {
  const issues = [];
  const ids = new Set();
  const outgoing = new Map();

  for (const migration of migrations) {
    if (ids.has(migration.id)) {
      issues.push(`Duplicate migration id: ${migration.id}`);
    }
    ids.add(migration.id);
    if (outgoing.has(migration.from)) {
      issues.push(
        `Ambiguous migrations from version ${migration.from}: ${outgoing.get(migration.from).id} and ${migration.id}`,
      );
    } else {
      outgoing.set(migration.from, migration);
    }
    if (migration.to > currentVersion) {
      issues.push(
        `Migration ${migration.id} targets ${migration.to}, above current_version ${currentVersion}.`,
      );
    }
  }

  for (const version of versions) {
    if (version > currentVersion) {
      issues.push(`Schema version ${version} is above current_version ${currentVersion}.`);
      continue;
    }
    if (version === currentVersion) continue;
    const visited = new Set();
    let cursor = version;
    while (cursor !== currentVersion) {
      if (visited.has(cursor)) {
        issues.push(`Migration cycle detected while planning from version ${version}.`);
        break;
      }
      visited.add(cursor);
      const migration = outgoing.get(cursor);
      if (!migration) {
        issues.push(`No migration path from schema version ${version} to ${currentVersion}.`);
        break;
      }
      cursor = migration.to;
      if (cursor > currentVersion) {
        issues.push(`Migration path from ${version} overshoots current_version ${currentVersion}.`);
        break;
      }
    }
  }

  return [...new Set(issues)];
}

export function planMigrations(migrations, fromVersion, toVersion) {
  if (!Number.isSafeInteger(fromVersion) || !Number.isSafeInteger(toVersion)) {
    throw new SaveWeaverError("Migration versions must be integers.", {
      code: "INVALID_VERSION",
    });
  }
  if (fromVersion > toVersion) {
    throw new SaveWeaverError(
      `Downgrade migrations are not supported (${fromVersion} -> ${toVersion}).`,
      { code: "DOWNGRADE_NOT_SUPPORTED" },
    );
  }
  if (fromVersion === toVersion) return [];

  const outgoing = new Map();
  for (const migration of migrations) {
    if (outgoing.has(migration.from)) {
      throw new SaveWeaverError(`Migration graph is ambiguous at version ${migration.from}.`, {
        code: "AMBIGUOUS_MIGRATION_PATH",
      });
    }
    outgoing.set(migration.from, migration);
  }

  const plan = [];
  const visited = new Set();
  let cursor = fromVersion;
  while (cursor !== toVersion) {
    if (visited.has(cursor)) {
      throw new SaveWeaverError(`Migration cycle detected at version ${cursor}.`, {
        code: "MIGRATION_CYCLE",
      });
    }
    visited.add(cursor);
    const migration = outgoing.get(cursor);
    if (!migration) {
      throw new SaveWeaverError(`No migration path from ${fromVersion} to ${toVersion}.`, {
        code: "MIGRATION_PATH_MISSING",
        details: { fromVersion, toVersion, stoppedAt: cursor },
      });
    }
    if (migration.to > toVersion) {
      throw new SaveWeaverError(
        `Migration ${migration.id} overshoots requested version ${toVersion}.`,
        { code: "MIGRATION_PATH_OVERSHOOT" },
      );
    }
    plan.push(migration);
    cursor = migration.to;
  }
  return plan;
}
