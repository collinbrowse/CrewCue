/**
 * Machine-wide job queue for heavy builds and tests.
 *
 * Many agent sessions share one Mac. When `~/.claude/bin/slot` is installed, heavy commands run
 * through `slot run`, which waits until enough CPU credits are free (FIFO, never refuses) and may
 * print `slot: queued ...` while it waits. Without slot (CI, other machines) commands run as before.
 * CREWCUE_NO_SLOT=1 skips the queue.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Parallel jobs a queued build may use. Matches the 4 credits it asks for. */
export const BUILD_JOBS = 4;

export function slotPath(env = process.env) {
  return path.join(env.HOME || os.homedir(), ".claude", "bin", "slot");
}

/** Whether the machine-wide queue is installed and enabled. */
export function slotAvailable(env = process.env) {
  if (env.CREWCUE_NO_SLOT === "1") return false;
  try {
    fs.accessSync(slotPath(env), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The command and arguments that run `command args` through the queue when it is installed,
 * or unchanged when it isn't.
 * @param {string} command
 * @param {string[]} args
 * @param {{ credits?: number, label?: string, locks?: string[], kind?: string }} [options]
 * @returns {{ command: string, args: string[], queued: boolean }}
 */
export function slotted(command, args, { credits = BUILD_JOBS, label, locks = [], kind } = {}, env = process.env) {
  if (!slotAvailable(env)) return { command, args, queued: false };
  const options = ["run", "--credits", String(credits)];
  for (const lock of locks) options.push("--lock", lock);
  if (label) options.push("--label", label);
  if (kind) options.push("--kind", kind);
  return { command: slotPath(env), args: [...options, "--", command, ...args], queued: true };
}

/**
 * Runs a command (usually from `slotted`) with stderr going straight to the terminal, so
 * `slot: queued ...` shows while it waits. Resolves on exit 0; rejects with the stdout tail otherwise.
 */
export function runShowingQueue({ command, args }, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "inherit"] });
    let tail = "";
    child.stdout.on("data", (chunk) => {
      tail = (tail + chunk).slice(-20000);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} ${args.join(" ")} exited ${code ?? signal}\n${tail}`))));
  });
}
