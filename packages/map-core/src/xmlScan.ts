/**
 * Linear-time element scanning for the GPX and TCX readers.
 *
 * Each element is found by locating its open tag, then the first matching close tag after it.
 * The scan never goes back: when an open tag has no `>` or no close tag after it, no later
 * element can have one either, so the scan stops. That keeps parse time proportional to the
 * file size whatever the markup looks like, while returning the same elements a lazy
 * `<tag\b([^>]*)>([\s\S]*?)</tag>` match would.
 */

export type XmlElement = {
  /** Index of the open tag's `<`. */
  start: number;
  /** Index just past the close tag's `>`. */
  end: number;
  /** Text between the tag name and the open tag's `>` (empty when `openTagEnds` is false). */
  attributes: string;
  /** Text between the open tag and the close tag. */
  body: string;
};

export type XmlScanOptions = {
  /**
   * Namespace prefix pattern (regex source) allowed before the name, as in `gpxtpx:cad`.
   * `null` allows no prefix. Default `[\w-]+`.
   */
  prefix?: string | null;
  /**
   * When true (default) the open tag runs to its first `>` and the body starts after it.
   * When false the body starts right after the tag name (for `<tag\b[\s\S]*?</tag>` removals).
   */
  openTagEnds?: boolean;
};

function tagPatterns(names: string, options: XmlScanOptions): { open: RegExp; close: RegExp } {
  const prefix = options.prefix === undefined ? "[\\w-]+" : options.prefix;
  const prefixPart = prefix === null ? "" : `(?:${prefix}:)?`;
  return {
    open: new RegExp(`<${prefixPart}(?:${names})\\b`, "gi"),
    close: new RegExp(`<\\/${prefixPart}(?:${names})>`, "gi")
  };
}

/**
 * Elements named by `names` (regex source, case-insensitive, e.g. `"trkpt|rtept"`), in order,
 * starting at `from`.
 */
export function* scanXmlElements(
  text: string,
  names: string,
  options: XmlScanOptions = {},
  from = 0
): Generator<XmlElement> {
  const { open, close } = tagPatterns(names, options);
  const openTagEnds = options.openTagEnds ?? true;
  let position = from;
  for (;;) {
    open.lastIndex = position;
    const opened = open.exec(text);
    if (!opened) return;
    const nameEnd = opened.index + opened[0].length;
    let bodyStart = nameEnd;
    let attributes = "";
    if (openTagEnds) {
      const gt = text.indexOf(">", nameEnd);
      if (gt < 0) return;
      attributes = text.slice(nameEnd, gt);
      bodyStart = gt + 1;
    }
    close.lastIndex = bodyStart;
    const closed = close.exec(text);
    if (!closed) return;
    const end = closed.index + closed[0].length;
    yield { start: opened.index, end, attributes, body: text.slice(bodyStart, closed.index) };
    position = end;
  }
}

/** The first element named by `names`, or null. */
export function firstXmlElement(text: string, names: string, options: XmlScanOptions = {}): XmlElement | null {
  for (const element of scanXmlElements(text, names, options)) {
    return element;
  }
  return null;
}

/** `text` with every element named by `names` cut out. */
export function removeXmlElements(text: string, names: string, options: XmlScanOptions = {}): string {
  let out = "";
  let kept = 0;
  for (const element of scanXmlElements(text, names, options)) {
    out += text.slice(kept, element.start);
    kept = element.end;
  }
  return kept === 0 ? text : out + text.slice(kept);
}
