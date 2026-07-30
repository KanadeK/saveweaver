import { gunzipSync } from "node:zlib";

import { crc32 } from "./crc32.mjs";

const TAR_BLOCK_SIZE = 512;
const FIXED_MTIME = 499162500;

function readString(buffer, offset, length) {
  const field = buffer.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul === -1 ? field.length : nul).toString("utf8");
}

function readOctal(buffer, offset, length) {
  const text = readString(buffer, offset, length).trim();
  const value = text === "" ? 0 : Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid tar octal field: ${JSON.stringify(text)}.`);
  }
  return value;
}

function writeString(buffer, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) {
    throw new Error(`Tar field is too long: ${value}.`);
  }
  bytes.copy(buffer, offset);
}

function writeOctal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  if (text.length >= length) {
    throw new Error(`Tar numeric field is too large: ${value}.`);
  }
  writeString(buffer, offset, length, `${text}\0`);
}

function splitTarName(name) {
  if (Buffer.byteLength(name, "utf8") <= 100) return { name, prefix: "" };
  for (let index = name.lastIndexOf("/"); index > 0; index = name.lastIndexOf("/", index - 1)) {
    const prefix = name.slice(0, index);
    const suffix = name.slice(index + 1);
    if (
      Buffer.byteLength(prefix, "utf8") <= 155 &&
      Buffer.byteLength(suffix, "utf8") <= 100
    ) {
      return { name: suffix, prefix };
    }
  }
  throw new Error(`Tar path cannot fit in a ustar header: ${name}.`);
}

function isZeroBlock(block) {
  return block.every((byte) => byte === 0);
}

export function parseTarEntries(archive) {
  const data = Buffer.from(archive);
  const entries = [];
  const names = new Set();
  let offset = 0;
  let terminated = false;

  while (offset + TAR_BLOCK_SIZE <= data.length) {
    const header = data.subarray(offset, offset + TAR_BLOCK_SIZE);
    if (isZeroBlock(header)) {
      terminated = true;
      break;
    }
    const type = header[156];
    if (type !== 0 && type !== 0x30) {
      throw new Error(`Unsupported tar entry type ${String.fromCharCode(type)}.`);
    }
    const base = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const name = prefix === "" ? base : `${prefix}/${base}`;
    if (name === "" || names.has(name)) {
      throw new Error(`Invalid or duplicate tar path: ${name || "<empty>"}.`);
    }
    names.add(name);
    const size = readOctal(header, 124, 12);
    const contentStart = offset + TAR_BLOCK_SIZE;
    const contentEnd = contentStart + size;
    if (contentEnd > data.length) {
      throw new Error(`Truncated tar entry: ${name}.`);
    }
    entries.push({
      content: Buffer.from(data.subarray(contentStart, contentEnd)),
      mode: readOctal(header, 100, 8),
      name,
    });
    offset = contentStart + Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
  }

  if (!terminated) throw new Error("Tar archive is missing its end marker.");
  return entries;
}

function createHeader(entry, executable) {
  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  const path = splitTarName(entry.name);
  writeString(header, 0, 100, path.name);
  writeOctal(header, 100, 8, executable ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.content.length);
  writeOctal(header, 136, 12, FIXED_MTIME);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeOctal(header, 329, 8, 0);
  writeOctal(header, 337, 8, 0);
  writeString(header, 345, 155, path.prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

export function createCanonicalTar(entries, options = {}) {
  const executablePaths = new Set(options.executablePaths ?? []);
  const ordered = entries
    .map((entry) => ({ content: Buffer.from(entry.content), name: entry.name }))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const names = new Set();
  const blocks = [];
  for (const entry of ordered) {
    if (entry.name === "" || names.has(entry.name)) {
      throw new Error(`Invalid or duplicate tar path: ${entry.name || "<empty>"}.`);
    }
    names.add(entry.name);
    blocks.push(createHeader(entry, executablePaths.has(entry.name)), entry.content);
    const padding = (TAR_BLOCK_SIZE - (entry.content.length % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));
  return Buffer.concat(blocks);
}

export function createStoredGzip(input) {
  const data = Buffer.from(input);
  const blocks = [];
  if (data.length === 0) blocks.push(Buffer.from([1, 0, 0, 0xff, 0xff]));
  for (let offset = 0; offset < data.length; offset += 0xffff) {
    const length = Math.min(0xffff, data.length - offset);
    const header = Buffer.alloc(5);
    header[0] = offset + length === data.length ? 1 : 0;
    header.writeUInt16LE(length, 1);
    header.writeUInt16LE((~length) & 0xffff, 3);
    blocks.push(header, data.subarray(offset, offset + length));
  }
  const gzipHeader = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0xff]);
  const footer = Buffer.alloc(8);
  footer.writeUInt32LE(crc32(data), 0);
  footer.writeUInt32LE(data.length >>> 0, 4);
  return Buffer.concat([gzipHeader, ...blocks, footer]);
}

export function normalizeNpmTarball(tarball, options = {}) {
  const entries = parseTarEntries(gunzipSync(tarball));
  return createStoredGzip(createCanonicalTar(entries, options));
}
