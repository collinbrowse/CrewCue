import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();

const nativeRoots = [
  { root: path.join(repoRoot, "apps/ios"), kind: "swift" },
  { root: path.join(repoRoot, "apps/android"), kind: "kotlin" },
  { root: path.join(repoRoot, "packages/client-core/Sources"), kind: "swift" }
];

const ignoredDirectories = new Set(["node_modules", ".expo", "dist", "build", ".build", ".gradle"]);

function isAllowedNetworkFile(filePath) {
  const normalized = filePath.split(path.sep).join("/");
  return (
    normalized.endsWith("packages/client-core/Sources/CrewCueClientCore/APIClient.swift") ||
    normalized.endsWith("apps/android/app/src/main/kotlin/com/crewcue/android/net/OkHttpTransport.kt")
  );
}

async function listFilesRecursively(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFilesRecursively(fullPath)));
    else files.push(fullPath);
  }
  return files;
}

async function main() {
  const violations = [];
  for (const { root, kind } of nativeRoots) {
    const files = await listFilesRecursively(root);
    for (const filePath of files) {
      if (isAllowedNetworkFile(filePath)) continue;
      const content = await readFile(filePath, "utf8");
      if (kind === "swift" && filePath.endsWith(".swift") && /\bURLSession\b/.test(content)) {
        violations.push({ file: path.relative(repoRoot, filePath), rule: "URLSession" });
      }
      if (kind === "kotlin" && filePath.endsWith(".kt") && /\bOkHttp\b|\bHttpURLConnection\b/.test(content)) {
        violations.push({ file: path.relative(repoRoot, filePath), rule: "OkHttp" });
      }
      if (/\.(ts|tsx|js|jsx)$/.test(filePath) && /\bfetch\s*\(|\baxios\b|\bXMLHttpRequest\b/.test(content)) {
        violations.push({ file: path.relative(repoRoot, filePath), rule: "raw JS networking" });
      }
    }
  }

  if (violations.length > 0) {
    console.error("Dual-client guard failed: networking must stay in the client-core transport or OkHttpTransport.kt.");
    for (const violation of violations) {
      console.error(`- ${violation.file}: ${violation.rule}`);
    }
    process.exit(1);
  }

  console.log("Dual-client guard passed: native networking stays in the transport adapters.");
}

main().catch((error) => {
  console.error("Dual-client guard crashed:", error);
  process.exit(1);
});
