import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Test helper for restart tests: runs `script` (an ES module) in a fresh Node process, with nothing
 * in memory, as after an API restart. argv[1] is the built app module's file URL, and `args` follow
 * it. The script prints one `RESULT:<json>` line; that JSON is returned.
 */
export function runInFreshProcess<T = unknown>(script: string, args: string[] = []): T {
  const appModule = fileURLToPath(new URL("../app.js", import.meta.url));
  const out = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", script, new URL(`file://${appModule}`).href, ...args],
    { encoding: "utf8", env: process.env, timeout: 45_000 }
  );
  const line = out.split("\n").find((candidate) => candidate.startsWith("RESULT:"));
  if (line === undefined) {
    throw new Error(`fresh process printed no RESULT: line\n${out}`);
  }
  return JSON.parse(line.slice("RESULT:".length)) as T;
}
