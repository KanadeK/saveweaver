import { RECEIPT_FORMAT_VERSION, PACKAGE_NAME, PACKAGE_VERSION } from "./version.js";
import { sha256Json } from "./util.js";

export function createReceipt(project, sourcePath, result) {
  return {
    format: RECEIPT_FORMAT_VERSION,
    tool: {
      name: PACKAGE_NAME,
      version: PACKAGE_VERSION,
    },
    project: project.config.name,
    source: sourcePath,
    from_version: result.fromVersion,
    to_version: result.toVersion,
    source_sha256: result.sourceHash,
    output_sha256: result.outputHash,
    steps: result.steps,
    changes: result.changes,
  };
}

export function verifyReceipt(receipt, outputDocument) {
  const issues = [];
  if (receipt.format !== RECEIPT_FORMAT_VERSION) {
    issues.push(`Unsupported receipt format: ${receipt.format}`);
  }
  const actualHash = sha256Json(outputDocument);
  if (receipt.output_sha256 !== actualHash) {
    issues.push(
      `Output hash mismatch: receipt=${receipt.output_sha256}, actual=${actualHash}`,
    );
  }
  return { ok: issues.length === 0, issues, actualHash };
}
