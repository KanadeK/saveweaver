import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { SaveWeaverError } from "./errors.js";
import { createLock } from "./lock.js";
import { loadProject } from "./project.js";
import { canonicalJson, writeJsonAtomic, writeTextAtomic } from "./util.js";

const SAMPLE_SAVE = {
  meta: { save_version: 1 },
  player: { name: "Ada", level: 1 },
};

const SAMPLE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "My Game Save v1",
  type: "object",
  required: ["meta", "player"],
  properties: {
    meta: {
      type: "object",
      required: ["save_version"],
      properties: {
        save_version: { const: 1 },
      },
      additionalProperties: false,
    },
    player: {
      type: "object",
      required: ["name", "level"],
      properties: {
        name: { type: "string", minLength: 1 },
        level: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export async function scaffoldProject(targetDirectory) {
  const root = path.resolve(targetDirectory);
  await mkdir(root, { recursive: true });
  const existing = await readdir(root);
  if (existing.length > 0) {
    throw new SaveWeaverError(`Refusing to initialize a non-empty directory: ${root}`, {
      code: "DIRECTORY_NOT_EMPTY",
    });
  }

  const config = {
    format: 1,
    name: path.basename(root),
    current_version: 1,
    version_pointer: "/meta/save_version",
    schemas: {
      1: "schemas/v1.schema.json",
    },
    migrations: [],
    fixture_dirs: ["fixtures"],
    lock_file: ".saveweaver.lock.json",
    policy: {
      require_all_schemas: true,
    },
  };

  await writeJsonAtomic(path.join(root, "saveweaver.json"), config);
  await writeJsonAtomic(path.join(root, "schemas", "v1.schema.json"), SAMPLE_SCHEMA);
  await writeJsonAtomic(path.join(root, "fixtures", "v1", "example.json"), SAMPLE_SAVE);
  await writeTextAtomic(
    path.join(root, "migrations", "README.md"),
    "# Migrations\n\nAdd ordered declarative migration JSON files here and list them in `saveweaver.json`.\n",
  );
  await writeTextAtomic(
    path.join(root, "README.md"),
    `# ${config.name}\n\nThis directory was initialized by SaveWeaver.\n\nRun:\n\n\`\`\`sh\nsaveweaver lock\nsaveweaver check\n\`\`\`\n`,
  );
  const project = await loadProject(root);
  const lock = await createLock(project);
  await writeTextAtomic(project.lockPath, canonicalJson(lock));
  return project;
}
