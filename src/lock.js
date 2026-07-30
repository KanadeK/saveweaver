import { LOCK_FORMAT_VERSION, PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";
import {
  canonicalJson,
  pathExists,
  readJson,
  relativePosix,
  sha256File,
} from "./util.js";

export async function createLock(project) {
  const paths = [
    project.configPath,
    ...[...project.schemas.values()].map((entry) => entry.path),
    ...project.migrations.map((entry) => entry.path),
  ];
  const uniquePaths = [...new Set(paths)].sort((left, right) =>
    relativePosix(project.root, left).localeCompare(relativePosix(project.root, right)),
  );
  const files = [];
  for (const filePath of uniquePaths) {
    files.push({
      path: relativePosix(project.root, filePath),
      sha256: await sha256File(filePath),
    });
  }
  return {
    format: LOCK_FORMAT_VERSION,
    tool: { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    project: project.config.name,
    current_version: project.config.current_version,
    files,
  };
}

export async function checkLock(project) {
  if (!(await pathExists(project.lockPath))) {
    return { ok: false, issues: [`Lock file is missing: ${project.lockRelativePath}`] };
  }
  const expected = await readJson(project.lockPath, "SaveWeaver lock file");
  const actual = await createLock(project);
  if (canonicalJson(expected) === canonicalJson(actual)) {
    return { ok: true, issues: [], expected, actual };
  }

  const issues = [];
  const expectedFiles = new Map((expected.files ?? []).map((entry) => [entry.path, entry.sha256]));
  const actualFiles = new Map(actual.files.map((entry) => [entry.path, entry.sha256]));
  for (const filePath of [...new Set([...expectedFiles.keys(), ...actualFiles.keys()])].sort()) {
    if (!expectedFiles.has(filePath)) {
      issues.push(`Untracked contract file: ${filePath}`);
    } else if (!actualFiles.has(filePath)) {
      issues.push(`Locked contract file is missing: ${filePath}`);
    } else if (expectedFiles.get(filePath) !== actualFiles.get(filePath)) {
      issues.push(`Contract file changed: ${filePath}`);
    }
  }
  if (expected.current_version !== actual.current_version) {
    issues.push(
      `current_version changed: ${expected.current_version} -> ${actual.current_version}`,
    );
  }
  return { ok: false, issues, expected, actual };
}
