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

export type FreshProcessStep = { method: string; url: string; user: string; payload?: unknown };

/**
 * Runs `steps` against a fresh API process (nothing of the room in memory, so it all comes back
 * from Postgres) and returns each step's status and body. Each step is signed as `user` on team-1.
 */
export function runStepsInFreshProcess(steps: FreshProcessStep[]): Array<{ status: number; body: unknown }> {
  const script = `
    const { buildApp } = await import(process.argv[1]);
    const steps = JSON.parse(process.argv[2]);
    const app = buildApp();
    await app.ready();
    const out = [];
    for (const step of steps) {
      const token = app.jwt.sign({ sub: step.user, teamIds: ["team-1"], roomRoles: {} });
      const res = await app.inject({
        method: step.method,
        url: step.url,
        payload: step.payload,
        headers: { authorization: "Bearer " + token }
      });
      out.push({ status: res.statusCode, body: res.json() });
    }
    process.stdout.write("\\nRESULT:" + JSON.stringify(out) + "\\n");
    await app.close();
    process.exit(0);
  `;
  return runInFreshProcess<Array<{ status: number; body: unknown }>>(script, [JSON.stringify(steps)]);
}
