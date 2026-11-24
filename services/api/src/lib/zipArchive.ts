/**
 * Minimal .zip reader for activity exports (Garmin "Export Original", COROS bulk export). Reads the
 * central directory and inflates stored or deflated entries with node:zlib, so no archive
 * dependency is needed. Zip64, encryption and multi-disk archives are refused.
 */
import { inflateRawSync } from "node:zlib";

export class ZipArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipArchiveError";
  }
}

/** `bytes` is null for a file over `maxEntryBytes`: listed, never inflated. */
export type ZipEntry = { name: string; bytes: Uint8Array | null };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Files in the archive, in directory order. Folders, macOS resource forks (`__MACOSX/`, `._*`) and
 * hidden files are skipped. Stops with ZipArchiveError past `maxEntries` or when an entry would
 * inflate beyond `maxEntryBytes` / the total beyond `maxTotalBytes`.
 */
export function readZipEntries(
  bytes: Uint8Array,
  limits: { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number }
): ZipEntry[] {
  return [...zipEntries(bytes, limits)];
}

/**
 * The same files as {@link readZipEntries}, inflated one at a time, so a large export never holds
 * every file in memory at once.
 */
export function* zipEntries(
  bytes: Uint8Array,
  limits: { maxEntries: number; maxEntryBytes: number; maxTotalBytes: number }
): Generator<ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: last 22 bytes, or earlier when there's a comment (≤ 65535 bytes).
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new ZipArchiveError("Couldn't read this .zip file.");
  const entryCount = view.getUint16(eocd + 10, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff) {
    throw new ZipArchiveError("This .zip is too large. Export fewer runs at a time.");
  }

  let count = 0;
  let total = 0;
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new ZipArchiveError("Couldn't read this .zip file.");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    const base = name.split("/").pop() ?? "";
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || base.startsWith(".") || base === "") continue;
    if (flags & 0x1) throw new ZipArchiveError("This .zip is password-protected.");
    if (count >= limits.maxEntries) {
      throw new ZipArchiveError(`This .zip has more than ${limits.maxEntries} files. Export fewer runs at a time.`);
    }
    if (size > limits.maxEntryBytes) {
      count += 1;
      yield { name: base, bytes: null };
      continue;
    }
    total += size;
    if (total > limits.maxTotalBytes) {
      throw new ZipArchiveError("This .zip unpacks to too much data. Export fewer runs at a time.");
    }

    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new ZipArchiveError("Couldn't read this .zip file.");
    }
    const dataStart =
      localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (data.length !== compressedSize) throw new ZipArchiveError("Couldn't read this .zip file.");
    let content: Uint8Array;
    if (method === 0) {
      content = data;
    } else if (method === 8) {
      try {
        content = new Uint8Array(inflateRawSync(data, { maxOutputLength: limits.maxEntryBytes }));
      } catch {
        throw new ZipArchiveError("Couldn't read this .zip file.");
      }
    } else {
      throw new ZipArchiveError("This .zip uses a compression CrewCue can't read.");
    }
    count += 1;
    yield { name: base, bytes: content };
  }
}
