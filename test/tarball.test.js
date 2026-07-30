import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

import {
  createCanonicalTar,
  createStoredGzip,
  normalizeNpmTarball,
  parseTarEntries,
} from "../scripts/lib/tarball.mjs";

const sampleEntries = [
  { name: "package/bin/saveweaver.js", content: Buffer.from("#!/usr/bin/env node\n") },
  { name: "package/README.md", content: Buffer.from("# Sample\n") },
];
const executablePaths = ["package/bin/saveweaver.js"];

test("canonical tar ordering and metadata do not depend on input order", () => {
  const forward = createCanonicalTar(sampleEntries, { executablePaths });
  const reverse = createCanonicalTar([...sampleEntries].reverse(), { executablePaths });
  assert.deepEqual(forward, reverse);
  assert.deepEqual(
    parseTarEntries(forward).map(({ mode, name }) => ({ mode, name })),
    [
      { mode: 0o644, name: "package/README.md" },
      { mode: 0o755, name: "package/bin/saveweaver.js" },
    ],
  );
});

test("stored gzip output is fixed and standards-compatible", () => {
  const tar = createCanonicalTar(sampleEntries, { executablePaths });
  const gzip = createStoredGzip(tar);
  assert.deepEqual(gunzipSync(gzip), tar);
  assert.deepEqual([...gzip.subarray(0, 10)], [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff]);
  assert.deepEqual(gzip, createStoredGzip(tar));
  assert.deepEqual(gunzipSync(createStoredGzip(Buffer.alloc(0))), Buffer.alloc(0));
});

test("npm tarball normalization removes platform mode and gzip differences", () => {
  const windowsTar = createCanonicalTar(sampleEntries);
  const unixTar = createCanonicalTar(sampleEntries, { executablePaths });
  const windowsPackage = gzipSync(windowsTar);
  const unixPackage = gzipSync(unixTar, { level: 9 });
  const expected = normalizeNpmTarball(windowsPackage, { executablePaths });
  assert.deepEqual(
    normalizeNpmTarball(unixPackage, { executablePaths }),
    expected,
  );
  assert.equal(
    parseTarEntries(gunzipSync(expected)).find(
      (entry) => entry.name === "package/bin/saveweaver.js",
    ).mode,
    0o755,
  );
});

test("tar validation rejects duplicate, unsupported, and truncated inputs", () => {
  assert.throws(
    () => createCanonicalTar([sampleEntries[0], sampleEntries[0]]),
    /duplicate tar path/,
  );
  const tar = createCanonicalTar(sampleEntries);
  const unsupported = Buffer.from(tar);
  unsupported[156] = "2".charCodeAt(0);
  assert.throws(() => parseTarEntries(unsupported), /Unsupported tar entry type/);
  assert.throws(
    () => parseTarEntries(tar.subarray(0, 600)),
    /missing its end marker/,
  );
});
