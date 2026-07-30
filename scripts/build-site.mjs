import path from "node:path";

import { runCompatibilityMatrix } from "../src/matrix.js";
import { loadProject } from "../src/project.js";
import { writeJsonAtomic } from "../src/util.js";
import { repositoryRoot } from "./lib/repository.mjs";

const project = await loadProject(
  path.join(repositoryRoot, "examples", "space-ranger"),
);
const report = await runCompatibilityMatrix(project);
if (!report.summary.ok) {
  throw new Error("Refusing to build the site with a failing example matrix.");
}
await writeJsonAtomic(path.join(repositoryRoot, "site", "matrix.json"), report);
process.stdout.write(
  `Built Pages data: ${report.summary.passed}/${report.summary.total} fixtures passed.\n`,
);
