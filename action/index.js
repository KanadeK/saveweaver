import { appendFileSync } from "node:fs";
import path from "node:path";

import { runCli } from "../src/cli.js";

const project = process.env.INPUT_PROJECT || ".";
const command = process.env.INPUT_COMMAND || "check";
const report = process.env.INPUT_REPORT || "saveweaver-matrix.md";

if (!["check", "matrix"].includes(command)) {
  process.stderr.write(`SaveWeaver Action: unsupported command ${command}\n`);
  process.exitCode = 2;
} else {
  const commandExit = await runCli([command, "--project", project], {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
  });
  const reportExit = await runCli(
    ["matrix", "--project", project, "--format", "markdown", "--out", report],
    {
      cwd: process.cwd(),
      stdout: process.stdout,
      stderr: process.stderr,
    },
  );
  const ok = commandExit === 0 && reportExit === 0;

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `result=${ok ? "pass" : "fail"}\nreport=${path.resolve(report)}\n`,
      "utf8",
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## SaveWeaver\n\n${ok ? "✅ Compatibility gate passed." : "❌ Compatibility gate failed."}\n\nReport: \`${report}\`\n`,
      "utf8",
    );
  }
  process.exitCode = ok ? 0 : 1;
}
