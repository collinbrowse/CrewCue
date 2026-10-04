import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

function findApiRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i += 1) {
    const packageJsonPath = resolve(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
      if (packageJson.name === "@crewcue/api") {
        return dir;
      }
    }
    dir = resolve(dir, "..");
  }
  throw new Error("@crewcue/api package root not found");
}

function runBacktestCli(args: string[]): string {
  const result = spawnSync("npm", ["run", "pacing:backtest", "--", ...args], {
    cwd: findApiRoot(),
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" }
  });
  assert.equal(
    result.status,
    0,
    `pacing:backtest failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  return result.stdout;
}

function assertBacktestReport(stdout: string): void {
  assert.match(stdout, /=== 50k example/);
  assert.match(stdout, /course \d+\.\d{2} km . history-backed/);
  assert.match(stdout, /Checkpoint\s+Dist\(km\)\s+Predicted\s+Actual\s+SignedErr/);
  assert.match(stdout, /Finish predicted \d+:\d{2}:\d{2} . actual \d+:\d{2}:\d{2} . signed error [+-]\d+:\d{2}:\d{2}/);
  assert.match(stdout, /MAE \d+:\d{2}:\d{2} over \d+ scored checkpoint\(s\)/);
}

test("pacing:backtest discovers default fixture scenarios", () => {
  const stdout = runBacktestCli([]);
  assertBacktestReport(stdout);
});

test("pacing:backtest runs an explicitly requested fixture scenario", () => {
  const stdout = runBacktestCli(["backtest-50k-example.json"]);
  assertBacktestReport(stdout);
});
