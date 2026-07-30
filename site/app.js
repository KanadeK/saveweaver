const summary = document.querySelector("#summary");
const body = document.querySelector("#matrix-body");

function cell(value, className) {
  const element = document.createElement("td");
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

try {
  const response = await fetch("./matrix.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const report = await response.json();
  summary.textContent = `${report.summary.passed}/${report.summary.total} fixtures passed`;
  body.replaceChildren();
  for (const fixture of report.fixtures) {
    const row = document.createElement("tr");
    row.append(
      cell(fixture.file),
      cell(fixture.status === "pass" ? `v${fixture.source_version}` : "—"),
      cell(fixture.status === "pass" ? `v${fixture.target_version}` : "—"),
      cell(
        fixture.status === "pass"
          ? fixture.migrations.join(" → ") || "already current"
          : fixture.error.code,
      ),
      cell(fixture.status === "pass" ? "PASS" : "FAIL", fixture.status),
    );
    body.append(row);
  }
} catch (error) {
  summary.textContent = "Matrix unavailable";
  body.replaceChildren();
  const row = document.createElement("tr");
  const message = cell(`Could not load generated matrix data: ${error.message}`);
  message.colSpan = 5;
  row.append(message);
  body.append(row);
}
