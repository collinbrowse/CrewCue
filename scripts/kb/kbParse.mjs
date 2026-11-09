/**
 * Pure parsers for the knowledge base generator. Pattern-based on purpose: fast, no compiler,
 * and good enough to point a reviewer at the right line. Tested in kbParse.test.mjs.
 */

const ROUTE_RE = /\bapp\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;

/** Classify the guard a handler body uses. Order matters: most specific first. */
export function classifyGuard(body) {
  if (/\brequireCourseEditor\(/.test(body)) return "course-editor";
  if (/\brequireRoomMember\(/.test(body)) return "room-member";
  if (/automation\w*Guard|assertAutomation\w*\(/i.test(body)) return "automation";
  const identity = /\brequest\.identity\b|\brequire\w*Identity\(|\bidentity\s*=\s*request\./.test(body);
  const secret = /hasValid\w*Secret\(|headers\[?["'.]?x-[\w-]*secret|timingSafeEqual/i.test(body);
  const membership = /\.memberships\.(find|some|map|filter)\(|\bmembership\b|\bisMember\w*\(/.test(body);
  if (identity && secret) return "identity or shared-secret";
  const owner = /\.athleteId\s*[!=]==?\s*request\.identity|request\.identity\??\.sub\s*[!=]==?\s*\w+\.athleteId/.test(body);
  if (identity && membership) return "identity + membership";
  if (identity && owner) return "identity + owner";
  if (identity) return "identity";
  if (secret) return "shared-secret";
  return "none detected";
}

/**
 * Find `app.<verb>("<path>", ...)` routes. A handler's body runs to the next route (or the end
 * of the file), which is where the guard check is expected to sit.
 */
export function parseRoutes(text) {
  const matches = [...text.matchAll(ROUTE_RE)];
  return matches.map((m, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(m.index, end);
    let guard = classifyGuard(body);
    if (guard === "none detected") {
      // One level of delegation: `return upsertStopPlan(app, request, reply)`.
      for (const call of body.matchAll(/\b(\w+)\(\s*app\s*,\s*request\b/g)) {
        const helper = functionBody(text, call[1]);
        if (helper && classifyGuard(helper) !== "none detected") {
          guard = `${classifyGuard(helper)} (via ${call[1]})`;
          break;
        }
      }
    }
    return { method: m[1].toUpperCase(), path: m[2], line: text.slice(0, m.index).split("\n").length, guard };
  });
}

/** Body of a top-level `function name(` or `const name = async (` in the same file, up to its closing brace at column 0. */
function functionBody(text, name) {
  const start = text.search(new RegExp(`^(?:export\\s+)?(?:async\\s+)?(?:function\\s+${name}\\b|const\\s+${name}\\s*=)`, "m"));
  if (start < 0) return null;
  const close = text.indexOf("\n}", start);
  return text.slice(start, close < 0 ? text.length : close);
}

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Split a CREATE TABLE body on top-level commas. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const CONSTRAINT_RE = /^(PRIMARY\s+KEY|UNIQUE|CONSTRAINT|FOREIGN\s+KEY|CHECK|EXCLUDE)\b/i;

function columnType(rest) {
  return rest
    .replace(/\s+/g, " ")
    .replace(/\s+(NOT NULL|NULL|DEFAULT .*|PRIMARY KEY.*|REFERENCES .*|UNIQUE.*|CHECK .*)$/i, (m) => m)
    .trim();
}

/** Replay migrations in order into a table list. Handles CREATE/ALTER ADD/DROP COLUMN/DROP TABLE/INDEX. */
export function parseMigrations(migrations) {
  const tables = new Map();
  const dropped = new Set();
  const ordered = [...migrations].sort((a, b) => a.file.localeCompare(b.file));
  for (const { file, text } of ordered) {
    const sql = stripSqlComments(text);
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)\s*\(([\s\S]*?)\)\s*;/gi)) {
      const name = m[1].replace(/"/g, "");
      const table = { name, createdIn: file, alteredIn: [], columns: [], primaryKey: null, indexes: [] };
      for (const part of splitTopLevel(m[2])) {
        const pk = part.match(/^PRIMARY\s+KEY\s*\(([^)]*)\)/i);
        if (pk) table.primaryKey = pk[1].replace(/\s+/g, " ").trim();
        if (CONSTRAINT_RE.test(part)) continue;
        const col = part.match(/^"?(\w+)"?\s+([\s\S]+)$/);
        if (!col) continue;
        table.columns.push({ name: col[1], type: columnType(col[2]) });
        if (/\bPRIMARY\s+KEY\b/i.test(col[2])) table.primaryKey = col[1];
      }
      tables.set(name, table);
      dropped.delete(name);
    }
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)\s+([\s\S]*?);/gi)) {
      const table = tables.get(m[1].replace(/"/g, ""));
      if (!table) continue;
      if (!table.alteredIn.includes(file)) table.alteredIn.push(file);
      for (const clause of splitTopLevel(m[2])) {
        const add = clause.match(/^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+([\s\S]+)$/i);
        if (add && !table.columns.some((c) => c.name === add[1])) table.columns.push({ name: add[1], type: columnType(add[2]) });
        const drop = clause.match(/^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/i);
        if (drop) table.columns = table.columns.filter((c) => c.name !== drop[1]);
        const pk = clause.match(/^ADD\s+(?:CONSTRAINT\s+\w+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i);
        if (pk) table.primaryKey = pk[1].replace(/\s+/g, " ").trim();
      }
    }
    for (const m of sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s+ON\s+([\w."]+)/gi)) {
      const table = tables.get(m[2].replace(/"/g, ""));
      if (table && !table.indexes.includes(m[1])) table.indexes.push(m[1]);
    }
    for (const m of sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.", ]+?)\s*(?:CASCADE)?\s*;/gi)) {
      for (const raw of m[1].split(",")) {
        const name = raw.trim().replace(/"/g, "");
        if (tables.delete(name) || name) dropped.add(name);
      }
    }
  }
  return {
    tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)),
    dropped: [...dropped].filter((n) => !tables.has(n)).sort()
  };
}

/** Module specifiers from static imports, re-exports, and dynamic imports. */
export function parseImports(text) {
  const specs = [];
  for (const m of text.matchAll(/\b(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']/g)) specs.push(m[1]);
  for (const m of text.matchAll(/\bimport\s*["']([^"']+)["']/g)) specs.push(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
  return specs;
}

/** `process.env.X`, `process.env["X"]`, and `const { X } = process.env`. */
export function parseEnvReads(text) {
  const names = new Set();
  for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/process\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g)) names.add(m[1]);
  for (const m of text.matchAll(/\{([^}]*)\}\s*=\s*process\.env\b/g)) {
    for (const part of m[1].split(",")) {
      const name = part.split(/[:=]/)[0].trim();
      if (/^[A-Z][A-Z0-9_]*$/.test(name)) names.add(name);
    }
  }
  return [...names].sort();
}

/** Top-level Swift type declarations (no leading indentation). */
export function parseSwiftTypes(text) {
  const names = [];
  for (const m of text.matchAll(/^(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|internal|private|fileprivate|open|final)\s+)*(struct|class|enum|protocol|actor)\s+(\w+)/gm)) {
    names.push(m[2]);
  }
  return names;
}

export function countMarkers(text) {
  const count = (word) => (text.match(new RegExp(`\\b${word}\\b[:(]`, "g")) ?? []).length;
  const out = { TODO: count("TODO"), FIXME: count("FIXME"), HACK: count("HACK") };
  return { ...out, total: out.TODO + out.FIXME + out.HACK };
}

export function findTimers(text) {
  const timers = [];
  for (const m of text.matchAll(/\b(setInterval|cron\.schedule|schedule\.scheduleJob)\(/g)) {
    timers.push({ kind: m[1], line: text.slice(0, m.index).split("\n").length });
  }
  return timers;
}
