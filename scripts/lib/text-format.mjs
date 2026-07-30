export function inspectTextFormat(source, { extension, relative }) {
  const issues = [];
  const normalized = source.replaceAll("\r\n", "\n");
  const withoutCrLf = source.replaceAll("\r\n", "");

  if (source.charCodeAt(0) === 0xfeff) {
    issues.push(`${relative}: UTF-8 BOM is not allowed`);
  }

  if (extension === ".cmd") {
    if (withoutCrLf.includes("\r")) {
      issues.push(`${relative}: unsupported carriage return`);
    }
    if (source.includes("\r\n") && withoutCrLf.includes("\n")) {
      issues.push(`${relative}: mixed LF and CRLF line endings`);
    }
  } else if (source.includes("\r")) {
    issues.push(`${relative}: use LF line endings`);
  }

  if (!normalized.endsWith("\n")) {
    issues.push(`${relative}: missing final newline`);
  }
  normalized.split("\n").forEach((line, index) => {
    if (/[ \t]+$/u.test(line)) {
      issues.push(`${relative}:${index + 1}: trailing whitespace`);
    }
  });

  return issues;
}
