import { access, readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const mobileRoot = path.join(repoRoot, "apps", "mobile");

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const mobilePkgPath = path.join(mobileRoot, "package.json");
  const mobilePkg = JSON.parse(await readFile(mobilePkgPath, "utf8"));
  const entry = mobilePkg.main;
  if (!entry || typeof entry !== "string") {
    throw new Error("apps/mobile/package.json must define a string `main` entry.");
  }

  const entryPath = path.join(mobileRoot, entry);
  if (!(await fileExists(entryPath))) {
    throw new Error(`Mobile entry file is missing: ${path.relative(repoRoot, entryPath)}`);
  }

  const entrySource = await readFile(entryPath, "utf8");
  if (!entrySource.includes("index.tsx")) {
    throw new Error("Mobile entry should forward to index.tsx to keep Metro entry resolution stable.");
  }

  const rootEntryPath = path.join(mobileRoot, "index.tsx");
  if (!(await fileExists(rootEntryPath))) {
    throw new Error("apps/mobile/index.tsx is missing.");
  }

  const rootEntrySource = await readFile(rootEntryPath, "utf8");
  if (!rootEntrySource.includes("registerRootComponent")) {
    throw new Error("apps/mobile/index.tsx must registerRootComponent(App).");
  }

  process.stdout.write("mobile-startup-smoke: ok\n");
}

main().catch((error) => {
  process.stderr.write(`mobile-startup-smoke: failed\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
