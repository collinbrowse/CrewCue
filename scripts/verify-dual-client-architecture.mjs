import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const mobileRoot = path.join(repoRoot, "apps/mobile");
const allowedNetworkSource = path.join(mobileRoot, "src/api/client.ts");

const sourceFileExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const ignoredSuffixes = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"];
const ignoredDirectories = new Set(["node_modules", ".expo", "dist", "build"]);

const disallowedPatterns = [
  { label: "fetch()", regex: /\bfetch\s*\(/ },
  { label: "axios", regex: /\baxios\b/ },
  { label: "XMLHttpRequest", regex: /\bXMLHttpRequest\b/ }
];

async function listFilesRecursively(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(fullPath)));
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

function shouldCheckFile(filePath) {
  const relative = path.relative(mobileRoot, filePath);
  if (!relative || relative.startsWith("..")) {
    return false;
  }
  const ext = path.extname(filePath);
  if (!sourceFileExtensions.has(ext)) {
    return false;
  }
  if (ignoredSuffixes.some((suffix) => relative.endsWith(suffix))) {
    return false;
  }
  return true;
}

async function main() {
  const files = await listFilesRecursively(mobileRoot);
  const violations = [];

  for (const filePath of files) {
    if (!shouldCheckFile(filePath)) {
      continue;
    }
    if (path.normalize(filePath) === path.normalize(allowedNetworkSource)) {
      continue;
    }

    const content = await readFile(filePath, "utf8");
    for (const rule of disallowedPatterns) {
      if (rule.regex.test(content)) {
        violations.push({
          file: path.relative(repoRoot, filePath),
          rule: rule.label
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error("Dual-client guard failed: raw networking found outside apps/mobile/src/api/client.ts");
    for (const violation of violations) {
      console.error(`- ${violation.file}: ${violation.rule}`);
    }
    process.exit(1);
  }

  console.log("Dual-client guard passed: mobile networking remains centralized in src/api/client.ts");
}

main().catch((error) => {
  console.error("Dual-client guard crashed:", error);
  process.exit(1);
});
