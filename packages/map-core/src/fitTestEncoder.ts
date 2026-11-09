/**
 * Minimal FIT writer for fixtures and tests only (not exported from the package index).
 * Writes file_id, record and session messages, little-endian, with a valid header and file CRC.
 */
import { fitCrc } from "./activityFile.js";

const FIT_EPOCH_OFFSET_SECONDS = 631065600;
const DEGREES_TO_SEMICIRCLES = 2 ** 31 / 180;

export type FitTestRecord = {
  timestampMs: number;
  latitude?: number;
  longitude?: number;
  elevationMeters?: number;
  distanceMeters?: number;
};

export type FitTestActivity = {
  fileType?: number;
  records: FitTestRecord[];
  session?: { startMs: number; elapsedSeconds: number; distanceMeters: number; ascentMeters?: number };
  /** Write records after the first with compressed-timestamp headers (needs ≤31 s gaps). */
  compressedTimestamps?: boolean;
};

class Writer {
  bytes: number[] = [];
  u8(value: number) {
    this.bytes.push(value & 0xff);
  }
  u16(value: number) {
    this.u8(value);
    this.u8(value >> 8);
  }
  u32(value: number) {
    this.u16(value & 0xffff);
    this.u16((value >>> 16) & 0xffff);
  }
  define(local: number, globalNum: number, fields: Array<[num: number, size: number, baseType: number]>) {
    this.u8(0x40 | local);
    this.u8(0);
    this.u8(0);
    this.u16(globalNum);
    this.u8(fields.length);
    for (const [num, size, baseType] of fields) {
      this.u8(num);
      this.u8(size);
      this.u8(baseType);
    }
  }
}

const fitSeconds = (ms: number) => Math.round(ms / 1000) - FIT_EPOCH_OFFSET_SECONDS;

export function encodeFitActivity(activity: FitTestActivity): Uint8Array {
  const body = new Writer();
  body.define(0, 0, [[0, 1, 0x00]]);
  body.u8(0);
  body.u8(activity.fileType ?? 4);

  const recordFields: Array<[number, number, number]> = [
    [253, 4, 0x86],
    [0, 4, 0x85],
    [1, 4, 0x85],
    [2, 2, 0x84],
    [5, 4, 0x86]
  ];
  body.define(1, 20, recordFields);
  // Local 2: record without timestamp, for compressed-timestamp headers.
  if (activity.compressedTimestamps) body.define(2, 20, recordFields.slice(1));

  activity.records.forEach((record, index) => {
    if (activity.compressedTimestamps && index > 0) {
      body.u8(0x80 | (2 << 5) | (fitSeconds(record.timestampMs) & 0x1f));
    } else {
      body.u8(1);
      body.u32(fitSeconds(record.timestampMs));
    }
    body.u32(record.latitude === undefined ? 0x7fffffff : Math.round(record.latitude * DEGREES_TO_SEMICIRCLES));
    body.u32(record.longitude === undefined ? 0x7fffffff : Math.round(record.longitude * DEGREES_TO_SEMICIRCLES));
    body.u16(record.elevationMeters === undefined ? 0xffff : Math.round((record.elevationMeters + 500) * 5));
    body.u32(record.distanceMeters === undefined ? 0xffffffff : Math.round(record.distanceMeters * 100));
  });

  if (activity.session) {
    body.define(3, 18, [
      [2, 4, 0x86],
      [7, 4, 0x86],
      [9, 4, 0x86],
      [22, 2, 0x84]
    ]);
    body.u8(3);
    body.u32(fitSeconds(activity.session.startMs));
    body.u32(Math.round(activity.session.elapsedSeconds * 1000));
    body.u32(Math.round(activity.session.distanceMeters * 100));
    body.u16(activity.session.ascentMeters === undefined ? 0xffff : Math.round(activity.session.ascentMeters));
  }

  const header = new Writer();
  header.u8(14);
  header.u8(0x20);
  header.u16(2132);
  header.u32(body.bytes.length);
  for (const char of ".FIT") header.u8(char.charCodeAt(0));
  const headerBytes = Uint8Array.from(header.bytes);
  header.u16(fitCrc(headerBytes));

  const out = Uint8Array.from([...header.bytes, ...body.bytes, 0, 0]);
  const crc = fitCrc(out, 0, out.length - 2);
  out[out.length - 2] = crc & 0xff;
  out[out.length - 1] = crc >> 8;
  return out;
}
