import { readFile, writeFile } from "node:fs/promises";

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const FIXED_DOS_DATE = 0x0021;

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(name, data, crc) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(FIXED_DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes]);
}

function centralHeader(name, data, crc, offset, executable) {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_SIGNATURE, 0);
  header.writeUInt16LE(0x031e, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(FIXED_DOS_DATE, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(nameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  const mode = executable ? 0o100755 : 0o100644;
  header.writeUInt32LE((mode << 16) >>> 0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, nameBytes]);
}

export async function createDeterministicZip(destination, entries) {
  const ordered = [...entries].sort((left, right) => left.name.localeCompare(right.name));
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of ordered) {
    const data = Buffer.isBuffer(entry.data)
      ? entry.data
      : await readFile(entry.source);
    const crc = crc32(data);
    const local = localHeader(entry.name, data, crc);
    locals.push(local, data);
    centrals.push(
      centralHeader(entry.name, data, crc, offset, Boolean(entry.executable)),
    );
    offset += local.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(ordered.length, 8);
  end.writeUInt16LE(ordered.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(destination, Buffer.concat([...locals, centralDirectory, end]));
}

export async function inspectStoredZip(filePath) {
  const data = await readFile(filePath);
  const entries = [];
  let offset = 0;
  while (offset + 4 <= data.length && data.readUInt32LE(offset) === LOCAL_SIGNATURE) {
    const flags = data.readUInt16LE(offset + 6);
    const compression = data.readUInt16LE(offset + 8);
    const expectedCrc = data.readUInt32LE(offset + 14);
    const compressedSize = data.readUInt32LE(offset + 18);
    const uncompressedSize = data.readUInt32LE(offset + 22);
    const nameLength = data.readUInt16LE(offset + 26);
    const extraLength = data.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = data.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const contentStart = nameStart + nameLength + extraLength;
    const content = data.subarray(contentStart, contentStart + compressedSize);
    const actualCrc = crc32(content);
    entries.push({
      name,
      flags,
      compression,
      compressedSize,
      uncompressedSize,
      expectedCrc,
      actualCrc,
      valid:
        compression === 0 &&
        compressedSize === uncompressedSize &&
        expectedCrc === actualCrc,
    });
    offset = contentStart + compressedSize;
  }
  return entries;
}
