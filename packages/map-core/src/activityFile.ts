/**
 * Past-activity file import (issue #652): GPX, FIT and TCX exports from Garmin, COROS, Suunto
 * and similar watches, reduced to one activity summary for pacing history.
 *
 * FIT is read by a small in-house decoder: only `file_id`, `record` and `session` messages are
 * used, so a full SDK dependency is not needed. TCX is read with the same tag-scanning approach
 * the GPX parser uses.
 */
import {
  computeElevationGainMeters,
  computeTrackDistanceMeters,
  parseGpxActivityTrack,
  type GpxTrackPoint
} from "./courseParse.js";

export const ACTIVITY_FILE_FORMATS = ["gpx", "fit", "tcx"] as const;
export type ActivityFileFormat = (typeof ACTIVITY_FILE_FORMATS)[number];

/** Largest activity file accepted. A 100-mile FIT with 1 s recording is about 5 MB. */
export const MAX_ACTIVITY_FILE_BYTES = 10 * 1024 * 1024;

export type ActivityFileErrorCode =
  | "file_empty"
  | "file_too_large"
  | "file_unsupported"
  | "file_corrupt"
  | "file_no_activity";

export class ActivityFileError extends Error {
  readonly code: ActivityFileErrorCode;

  constructor(code: ActivityFileErrorCode, message: string) {
    super(message);
    this.name = "ActivityFileError";
    this.code = code;
  }
}

export type ParsedActivityFile = {
  format: ActivityFileFormat;
  /** GPS track points. Empty for indoor or treadmill activities. */
  points: GpxTrackPoint[];
  distanceMeters: number;
  /** Activity start, epoch ms. Null when the file has no clock times. */
  startTimestampMs: number | null;
  /** Start-to-finish seconds, stops included. Null when the file has no clock times. */
  elapsedSeconds: number | null;
  /** Null when the file has no elevation. */
  elevationGainMeters: number | null;
};

const UNSUPPORTED_MESSAGE = "Unsupported file. Choose a .gpx, .fit or .tcx activity export.";
const NO_ACTIVITY_MESSAGE = "This file has no distance to import. Choose a recorded run.";

/** Format from the file name, falling back to the content. Null when neither looks like an activity. */
export function detectActivityFileFormat(bytes: Uint8Array, fileName?: string): ActivityFileFormat | null {
  if (looksLikeFit(bytes)) {
    return "fit";
  }
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 4096));
  if (/<TrainingCenterDatabase\b/i.test(head)) {
    return "tcx";
  }
  if (/<gpx\b/i.test(head)) {
    return "gpx";
  }
  const extension = fileName?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (extension === "gpx" || extension === "fit" || extension === "tcx") {
    return extension;
  }
  return null;
}

/**
 * Parse an exported activity file.
 * @throws {ActivityFileError} for empty, oversized, unsupported or unreadable files
 */
export function parseActivityFile(bytes: Uint8Array, fileName?: string): ParsedActivityFile {
  if (bytes.length === 0) {
    throw new ActivityFileError("file_empty", "The file is empty. Export the activity again and retry.");
  }
  if (bytes.length > MAX_ACTIVITY_FILE_BYTES) {
    throw new ActivityFileError("file_too_large", "The file is larger than 10 MB. Export a single activity.");
  }
  const format = detectActivityFileFormat(bytes, fileName);
  if (!format) {
    throw new ActivityFileError("file_unsupported", UNSUPPORTED_MESSAGE);
  }
  switch (format) {
    case "fit":
      return parseFitActivity(bytes);
    case "tcx":
      return parseTcxActivity(new TextDecoder().decode(bytes));
    case "gpx":
      return parseGpxActivity(new TextDecoder().decode(bytes));
  }
}

function summarize(
  format: ActivityFileFormat,
  points: GpxTrackPoint[],
  summary: { distanceMeters?: number; startTimestampMs?: number; elapsedSeconds?: number; ascentMeters?: number }
): ParsedActivityFile {
  const positioned = points.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  const trackDistance = positioned.length >= 2 ? computeTrackDistanceMeters(positioned) : 0;
  const distanceMeters = summary.distanceMeters && summary.distanceMeters > 0 ? summary.distanceMeters : trackDistance;
  if (!(distanceMeters > 0)) {
    throw new ActivityFileError("file_no_activity", NO_ACTIVITY_MESSAGE);
  }

  const times = points.map((point) => point.timestampMs).filter((value): value is number => value !== null);
  const startTimestampMs = summary.startTimestampMs ?? (times.length > 0 ? times[0]! : null);
  let elapsedSeconds: number | null = null;
  if (summary.elapsedSeconds && summary.elapsedSeconds > 0) {
    elapsedSeconds = summary.elapsedSeconds;
  } else if (times.length >= 2 && times[times.length - 1]! > times[0]!) {
    elapsedSeconds = (times[times.length - 1]! - times[0]!) / 1000;
  }

  let elevationGainMeters: number | null = null;
  if (summary.ascentMeters !== undefined && summary.ascentMeters >= 0) {
    elevationGainMeters = summary.ascentMeters;
  } else if (points.some((point) => point.elevationMeters !== null)) {
    elevationGainMeters = computeElevationGainMeters(points);
  }

  return {
    format,
    points: positioned,
    distanceMeters,
    startTimestampMs,
    elapsedSeconds,
    elevationGainMeters
  };
}

// MARK: GPX

function parseGpxActivity(xml: string): ParsedActivityFile {
  let parsed;
  try {
    parsed = parseGpxActivityTrack(xml);
  } catch (err) {
    const message = err instanceof Error ? err.message : "GPX parse failed";
    if (/empty|at least two track points|distance is zero/i.test(message)) {
      throw new ActivityFileError("file_no_activity", message);
    }
    throw new ActivityFileError("file_corrupt", "Couldn't read this GPX file. Export it again and retry.");
  }
  const timed = parsed.points.filter((point) => point.timestampMs !== null).length >= 2 && parsed.startTimestampMs > 0;
  return summarize("gpx", parsed.points, {
    distanceMeters: parsed.totalDistanceMeters,
    ...(timed ? { startTimestampMs: parsed.startTimestampMs, elapsedSeconds: parsed.totalDurationSeconds } : {})
  });
}

// MARK: TCX

function tagText(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"));
  return match ? match[1]!.trim() : null;
}

function tagNumber(block: string, tag: string): number | null {
  const text = tagText(block, tag);
  if (text === null) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "gi"))].map(
    (match) => match[0]
  );
}

export function parseTcxActivity(xml: string): ParsedActivityFile {
  const text = xml.replace(/^﻿/, "");
  if (!/<TrainingCenterDatabase\b/i.test(text) || !/<\/(?:\w+:)?TrainingCenterDatabase>/i.test(text)) {
    throw new ActivityFileError("file_corrupt", "Couldn't read this TCX file. Export it again and retry.");
  }
  const activity = blocks(text, "Activity")[0];
  if (!activity) {
    throw new ActivityFileError("file_no_activity", NO_ACTIVITY_MESSAGE);
  }

  const laps = blocks(activity, "Lap");
  let lapDistance = 0;
  let lapSeconds = 0;
  let firstLapStart: number | undefined;
  for (const lap of laps) {
    lapDistance += tagNumber(lap.replace(/<Track\b[\s\S]*<\/Track>/i, ""), "DistanceMeters") ?? 0;
    lapSeconds += tagNumber(lap, "TotalTimeSeconds") ?? 0;
    const start = lap.match(/<(?:\w+:)?Lap\b[^>]*StartTime="([^"]+)"/i)?.[1];
    const startMs = start ? Date.parse(start) : NaN;
    if (firstLapStart === undefined && Number.isFinite(startMs)) firstLapStart = startMs;
  }

  const points: GpxTrackPoint[] = [];
  let lastCumulative = 0;
  for (const trackpoint of blocks(activity, "Trackpoint")) {
    const time = tagText(trackpoint, "Time");
    const timestampMs = time ? Date.parse(time) : NaN;
    const latitude = tagNumber(trackpoint, "LatitudeDegrees");
    const longitude = tagNumber(trackpoint, "LongitudeDegrees");
    const cumulative = tagNumber(trackpoint, "DistanceMeters");
    if (cumulative !== null && cumulative > lastCumulative) lastCumulative = cumulative;
    points.push({
      latitude: latitude ?? NaN,
      longitude: longitude ?? NaN,
      elevationMeters: tagNumber(trackpoint, "AltitudeMeters"),
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : null
    });
  }

  const times = points.map((point) => point.timestampMs).filter((value): value is number => value !== null);
  const trackSeconds = times.length >= 2 ? (times[times.length - 1]! - times[0]!) / 1000 : 0;
  return summarize("tcx", points, {
    distanceMeters: lapDistance > 0 ? lapDistance : lastCumulative,
    ...(firstLapStart !== undefined ? { startTimestampMs: firstLapStart } : {}),
    // Elapsed includes stops; lap TotalTimeSeconds is moving time on some watches.
    elapsedSeconds: trackSeconds > 0 ? trackSeconds : lapSeconds
  });
}

// MARK: FIT

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
const FIT_EPOCH_OFFSET_SECONDS = 631065600;
const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31;

const MESG_FILE_ID = 0;
const MESG_SESSION = 18;
const MESG_RECORD = 20;
const FIT_FILE_TYPE_ACTIVITY = 4;

type FieldDefinition = { num: number; size: number; baseType: number };
type MessageDefinition = {
  littleEndian: boolean;
  globalNum: number;
  fields: FieldDefinition[];
  developerBytes: number;
};

function looksLikeFit(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    (bytes[0] === 12 || bytes[0] === 14) &&
    bytes[8] === 0x2e &&
    bytes[9] === 0x46 &&
    bytes[10] === 0x49 &&
    bytes[11] === 0x54
  );
}

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01,
  0x8801, 0x4400
];

/** FIT CRC-16 as defined by the FIT protocol. */
export function fitCrc(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let index = start; index < end; index += 1) {
    const byte = bytes[index]!;
    let tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf]!;
    tmp = CRC_TABLE[crc & 0xf]!;
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf]!;
  }
  return crc;
}

/** Reads one field value as an unsigned or signed integer; null when it holds the FIT invalid marker. */
function readFieldInt(view: DataView, offset: number, field: FieldDefinition, littleEndian: boolean): number | null {
  const baseNum = field.baseType & 0x1f;
  switch (baseNum) {
    case 0x00: // enum
    case 0x02: {
      // uint8
      const value = view.getUint8(offset);
      return value === 0xff ? null : value;
    }
    case 0x0a: {
      // uint8z
      const value = view.getUint8(offset);
      return value === 0 ? null : value;
    }
    case 0x01: {
      const value = view.getInt8(offset);
      return value === 0x7f ? null : value;
    }
    case 0x04: {
      const value = view.getUint16(offset, littleEndian);
      return value === 0xffff ? null : value;
    }
    case 0x03: {
      const value = view.getInt16(offset, littleEndian);
      return value === 0x7fff ? null : value;
    }
    case 0x06: {
      const value = view.getUint32(offset, littleEndian);
      return value === 0xffffffff ? null : value;
    }
    case 0x05: {
      const value = view.getInt32(offset, littleEndian);
      return value === 0x7fffffff ? null : value;
    }
    case 0x0c: {
      const value = view.getUint32(offset, littleEndian);
      return value === 0 ? null : value;
    }
    default:
      return null;
  }
}

type FitRecord = {
  timestamp: number | null;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  distance: number | null;
};

type FitSession = {
  startTime: number | null;
  elapsedSeconds: number | null;
  distanceMeters: number | null;
  ascentMeters: number | null;
};

function fitCorrupt(): ActivityFileError {
  return new ActivityFileError("file_corrupt", "Couldn't read this FIT file. Export it again and retry.");
}

export function parseFitActivity(bytes: Uint8Array): ParsedActivityFile {
  if (!looksLikeFit(bytes)) {
    throw fitCorrupt();
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: FitRecord[] = [];
  const sessions: FitSession[] = [];
  let fileType: number | null = null;

  // A FIT file may hold several chained FIT files back to back.
  let fileStart = 0;
  while (fileStart < bytes.length) {
    if (!looksLikeFit(bytes.subarray(fileStart))) {
      if (fileStart === 0) throw fitCorrupt();
      break;
    }
    const headerSize = bytes[fileStart]!;
    const dataSize = view.getUint32(fileStart + 4, true);
    const dataStart = fileStart + headerSize;
    const dataEnd = dataStart + dataSize;
    if (dataEnd + 2 > bytes.length) throw fitCorrupt();
    const storedCrc = view.getUint16(dataEnd, true);
    if (storedCrc !== 0 && storedCrc !== fitCrc(bytes, fileStart, dataEnd)) throw fitCorrupt();

    const definitions = new Map<number, MessageDefinition>();
    let lastTimestamp: number | null = null;
    let offset = dataStart;
    while (offset < dataEnd) {
      const header = bytes[offset]!;
      offset += 1;
      let localType: number;
      let compressedTimestamp: number | null = null;
      if (header & 0x80) {
        localType = (header >> 5) & 0x03;
        const timeOffset = header & 0x1f;
        if (lastTimestamp !== null) {
          let next: number = (lastTimestamp & ~0x1f) + timeOffset;
          if (timeOffset < (lastTimestamp & 0x1f)) next += 0x20;
          compressedTimestamp = next;
          lastTimestamp = next;
        }
      } else {
        localType = header & 0x0f;
        if (header & 0x40) {
          if (offset + 5 > dataEnd) throw fitCorrupt();
          const littleEndian = bytes[offset + 1] === 0;
          const globalNum = view.getUint16(offset + 2, littleEndian);
          const fieldCount = bytes[offset + 4]!;
          offset += 5;
          const fields: FieldDefinition[] = [];
          for (let index = 0; index < fieldCount; index += 1) {
            if (offset + 3 > dataEnd) throw fitCorrupt();
            fields.push({ num: bytes[offset]!, size: bytes[offset + 1]!, baseType: bytes[offset + 2]! });
            offset += 3;
          }
          let developerBytes = 0;
          if (header & 0x20) {
            const devCount = bytes[offset]!;
            offset += 1;
            for (let index = 0; index < devCount; index += 1) {
              developerBytes += bytes[offset + 1]!;
              offset += 3;
            }
          }
          definitions.set(localType, { littleEndian, globalNum, fields, developerBytes });
          continue;
        }
      }

      const definition = definitions.get(localType);
      if (!definition) throw fitCorrupt();
      const values = new Map<number, number | null>();
      for (const field of definition.fields) {
        if (offset + field.size > dataEnd) throw fitCorrupt();
        const baseSize = [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1, 8, 8, 8][field.baseType & 0x1f] ?? field.size;
        values.set(field.num, field.size >= baseSize ? readFieldInt(view, offset, field, definition.littleEndian) : null);
        offset += field.size;
      }
      offset += definition.developerBytes;
      if (offset > dataEnd) throw fitCorrupt();

      const stamped = values.get(253);
      if (stamped !== undefined && stamped !== null) lastTimestamp = stamped;
      const timestamp = stamped ?? compressedTimestamp;

      if (definition.globalNum === MESG_FILE_ID) {
        fileType = values.get(0) ?? fileType;
      } else if (definition.globalNum === MESG_RECORD) {
        const altitude = values.get(78) ?? values.get(2) ?? null;
        records.push({
          timestamp: timestamp ?? null,
          lat: values.get(0) ?? null,
          lon: values.get(1) ?? null,
          altitude: altitude === null ? null : altitude / 5 - 500,
          distance: values.get(5) == null ? null : values.get(5)! / 100
        });
      } else if (definition.globalNum === MESG_SESSION) {
        const elapsed = values.get(7);
        const distance = values.get(9);
        sessions.push({
          startTime: values.get(2) ?? null,
          elapsedSeconds: elapsed == null ? null : elapsed / 1000,
          distanceMeters: distance == null ? null : distance / 100,
          ascentMeters: values.get(22) ?? null
        });
      }
    }
    fileStart = dataEnd + 2;
  }

  if (fileType !== null && fileType !== FIT_FILE_TYPE_ACTIVITY) {
    throw new ActivityFileError("file_unsupported", "This FIT file is not an activity. Export a recorded run.");
  }

  const toMs = (fitSeconds: number) => (fitSeconds + FIT_EPOCH_OFFSET_SECONDS) * 1000;
  const points: GpxTrackPoint[] = records.map((record) => ({
    latitude: record.lat === null ? NaN : record.lat * SEMICIRCLES_TO_DEGREES,
    longitude: record.lon === null ? NaN : record.lon * SEMICIRCLES_TO_DEGREES,
    elevationMeters: record.altitude,
    timestampMs: record.timestamp === null ? null : toMs(record.timestamp)
  }));

  const sessionDistance = sessions.reduce((sum, session) => sum + (session.distanceMeters ?? 0), 0);
  const sessionElapsed = sessions.reduce((sum, session) => sum + (session.elapsedSeconds ?? 0), 0);
  const ascents = sessions.map((session) => session.ascentMeters).filter((value): value is number => value !== null);
  const recordDistance = records.reduce((max, record) => Math.max(max, record.distance ?? 0), 0);
  const firstStart = sessions.find((session) => session.startTime !== null)?.startTime;

  return summarize("fit", points, {
    distanceMeters: sessionDistance > 0 ? sessionDistance : recordDistance,
    ...(firstStart != null ? { startTimestampMs: toMs(firstStart) } : {}),
    ...(sessionElapsed > 0 ? { elapsedSeconds: sessionElapsed } : {}),
    ...(ascents.length > 0 ? { ascentMeters: ascents.reduce((sum, value) => sum + value, 0) } : {})
  });
}
