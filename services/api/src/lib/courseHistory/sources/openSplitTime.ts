/**
 * OpenSplitTime source: one OST event's public results ("spread") page → a course-history event.
 *
 * OpenSplitTime granted CrewCue permission to use its results (Nov 2026) and asked for an
 * unobtrusive attribution line; see `courseHistoryAttribution` in `../attribution.ts`.
 *
 * OST's JSON API needs a signed-in key that expires after 3 days, and OST offered to add a JSON
 * version of its planning data. Until then this reads the public spread page in elapsed style:
 * `/events/<slug>/spread?display_style=elapsed`. Finishers only; names, bibs and places are never
 * read. OST gives distances in miles and no checkpoint coordinates, so checkpoints link by name
 * and share of course (see `../link.ts`).
 */
import { COURSE_HISTORY_FORMAT_VERSION, validateCourseHistoryEvent, type CourseHistoryEvent, type CourseHistorySplit } from "../format.js";

export const OPENSPLITTIME_BASE_URL = "https://www.opensplittime.org";
const METERS_PER_MILE = 1609.344;

/** OST prints the race start with a US zone abbreviation; other zones are rejected, not guessed. */
const ZONE_OFFSET_HOURS: Record<string, number> = {
  UTC: 0, GMT: 0,
  EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7,
  AKST: -9, AKDT: -8, HST: -10
};
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export class OpenSplitTimeParseError extends Error {
  constructor(slug: string, problem: string) {
    super(`OpenSplitTime ${slug}: ${problem}`);
    this.name = "OpenSplitTimeParseError";
  }
}

// The output is plain text stored as data (never rendered as HTML). Entities decode in one pass so
// "&amp;lt;" stays "&lt;", and any "<" or ">" left after decoding is dropped.
const ENTITIES: Record<string, string> = { "&amp;": "&", "&#39;": "'", "&apos;": "'", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&nbsp;": " " };
const decode = (text: string) => text.replace(/&(?:amp|#39|apos|quot|lt|gt|nbsp);/g, (entity) => ENTITIES[entity]!);
function toText(html: string): string {
  // Strip tags until none are left (a removal can join two halves into a new tag), then decode.
  let text = html;
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== previous);
  return decode(text.replace(/[<>]/g, "")).replace(/[<>]/g, "");
}
const stripTags = (text: string) => toText(text).replace(/\s+/g, " ").trim();

/** "h:mm" or "h:mm:ss" elapsed (hours may exceed 24) → seconds; anything else (--, blank) → null. */
export function parseElapsed(text: string): number | null {
  const t = text.trim();
  if (!/^\d+:\d{2}(:\d{2})?$/.test(t)) return null;
  const [h, m, s = 0] = t.split(":").map(Number) as [number, number, number?];
  return h * 3600 + m * 60 + s;
}

/** "Friday, July 12, 2024 6:00AM (MDT)" → ISO with Z, or null. */
export function parseStartTime(subtitle: string): string | null {
  const m = /([A-Za-z]+) (\d{1,2}), (\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)\s*\(([A-Z]+)\)/.exec(subtitle);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!.toLowerCase());
  const offset = ZONE_OFFSET_HOURS[m[7]!];
  if (month < 0 || offset === undefined) return null;
  let hour = Number(m[4]) % 12;
  if (m[6] === "PM") hour += 12;
  const utc = Date.UTC(Number(m[3]), month, Number(m[2]), hour - offset, Number(m[5]));
  return new Date(utc).toISOString();
}

const slugId = (name: string, index: number) =>
  `${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cp"}`;

/**
 * Parse an elapsed-style spread page. Efforts with a missing or out-of-order time are dropped
 * (the format allows a missed mat, but OST pages show "--" mostly for unrecorded aid, and a clean
 * full set is what the cohort uses).
 */
export function openSplitTimeEventFromSpreadHtml(html: string, slug: string): CourseHistoryEvent {
  const subtitle = /<div class="ost-subtitle">\s*<p>([\s\S]*?)<\/p>/.exec(html);
  const startTime = subtitle ? parseStartTime(stripTags(subtitle[1]!)) : null;
  if (!startTime) throw new OpenSplitTimeParseError(slug, "no race start time with a known time zone");
  const title = /<title>([\s\S]*?)<\/title>/.exec(html);
  // "OpenSplitTime: Full results - Hardrock 100 2024" → "Hardrock 100 2024"
  const name = title ? stripTags(title[1]!).replace(/^OpenSplitTime:\s*/i, "").replace(/^Full results\s*-\s*/i, "") || slug : slug;

  const heads = [...html.matchAll(/<th class="text-nowrap text-center">([\s\S]*?)<\/th>/g)].map((h) =>
    toText(h[1]!.replace(/<br\s*\/?>/g, "|")).split("|").map((b) => b.replace(/\s+/g, " ").trim())
  );
  if (heads.length < 1) throw new OpenSplitTimeParseError(slug, "no checkpoint columns");
  const timed = heads.map((bits, index) => {
    const mile = /Mile ([\d.]+)/.exec(bits.join(" "));
    if (!mile) throw new OpenSplitTimeParseError(slug, `checkpoint "${bits[0]}" has no mileage`);
    return { id: slugId(bits[0]!, index + 1), name: bits[0]!, distanceMeters: Math.round(Number(mile[1]) * METERS_PER_MILE) };
  });
  const checkpoints = [{ id: "0-start", name: "Start", distanceMeters: 0 }, ...timed];

  const body = html.slice(Math.max(0, html.indexOf("<tbody")));
  const efforts: CourseHistoryEvent["efforts"] = [];
  for (const row of body.matchAll(/<tr id="effort_\d+"[\s\S]*?<\/tr>/g)) {
    const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[1]!));
    const status = cells.indexOf("Finished");
    if (status < 0 || cells.length < status + 1 + timed.length) continue;
    const splits: CourseHistorySplit[] = [];
    let last = 0;
    let ok = true;
    timed.forEach((cp, i) => {
      if (!ok) return;
      const [inText = "", outText] = cells[status + 1 + i]!.split("/");
      const inSeconds = parseElapsed(inText);
      const outSeconds = outText === undefined ? null : parseElapsed(outText);
      if (inSeconds === null || inSeconds < last || (outSeconds !== null && outSeconds < inSeconds)) {
        ok = false;
        return;
      }
      last = outSeconds ?? inSeconds;
      splits.push(outSeconds !== null && outSeconds > inSeconds ? { checkpointId: cp.id, inSeconds, outSeconds } : { checkpointId: cp.id, inSeconds });
    });
    if (ok && splits.length === timed.length && splits[splits.length - 1]!.inSeconds > 0) efforts.push({ splits });
  }

  const event: CourseHistoryEvent = {
    formatVersion: COURSE_HISTORY_FORMAT_VERSION,
    source: "opensplittime",
    sourceEventId: slug,
    name,
    startTime,
    checkpoints,
    efforts
  };
  const result = validateCourseHistoryEvent(event);
  if (!result.ok) throw new OpenSplitTimeParseError(slug, result.errors.slice(0, 3).join("; "));
  return result.event;
}

export function openSplitTimeSpreadUrl(slug: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new OpenSplitTimeParseError(slug, "event slug must be lowercase letters, digits and dashes");
  return `${OPENSPLITTIME_BASE_URL}/events/${slug}/spread?display_style=elapsed&sort=overall_rank`;
}

/** Fetch and parse events one at a time, a second apart, so the import stays light on OST. */
export async function fetchOpenSplitTimeEvents(
  slugs: readonly string[],
  fetchImpl: typeof fetch = fetch,
  pauseMs = 1000
): Promise<CourseHistoryEvent[]> {
  const out: CourseHistoryEvent[] = [];
  for (const [i, slug] of slugs.entries()) {
    if (i > 0 && pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
    const response = await fetchImpl(openSplitTimeSpreadUrl(slug), { headers: { "User-Agent": "CrewCue course-history import" } });
    if (!response.ok) throw new OpenSplitTimeParseError(slug, `HTTP ${response.status}`);
    out.push(openSplitTimeEventFromSpreadHtml(await response.text(), slug));
  }
  return out;
}
