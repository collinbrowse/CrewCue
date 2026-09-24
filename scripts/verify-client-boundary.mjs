#!/usr/bin/env node
/**
 * Native client boundary checks.
 * - client-core does not import UI or vendor SDK modules
 * - app trees do not grow a second API client or outbox
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "build" || entry.name === ".build" || entry.name === ".gradle") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const errors = [];
const coreRoot = path.join(repoRoot, "packages/client-core/Sources");
const forbiddenCore = [/\bimport\s+SwiftUI\b/, /\bimport\s+UIKit\b/, /\bimport\s+MapLibre\b/, /\bimport\s+StreamChat\b/, /\bimport\s+Auth0\b/];
for (const file of walk(coreRoot).filter((item) => item.endsWith(".swift"))) {
  const text = fs.readFileSync(file, "utf8");
  for (const rule of forbiddenCore) {
    if (rule.test(text)) errors.push(`${path.relative(repoRoot, file)} matches ${rule}`);
  }
}

const kotlinFiles = walk(path.join(repoRoot, "apps/android")).filter((item) => item.endsWith(".kt"));
for (const file of kotlinFiles) {
  const text = fs.readFileSync(file, "utf8");
  if (/\b(class|object)\s+Outbox\b/.test(text) || /\bfun\s+formatSchedule\b/.test(text)) {
    errors.push(`${path.relative(repoRoot, file)} reimplements shared client logic`);
  }
  if (/\bOkHttp\b|\bHttpURLConnection\b/.test(text) && !file.endsWith("OkHttpTransport.kt")) {
    errors.push(`${path.relative(repoRoot, file)} opens a network client`);
  }
}

const swiftApp = walk(path.join(repoRoot, "apps/ios")).filter((item) => item.endsWith(".swift"));
for (const file of swiftApp) {
  const text = fs.readFileSync(file, "utf8");
  if (/\bURLSession\b/.test(text) && !file.endsWith("HTTPTransport.swift")) {
    errors.push(`${path.relative(repoRoot, file)} opens URLSession outside the transport adapter`);
  }
}

if (errors.length) {
  console.error("verify:client-boundary failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log("verify:client-boundary passed");
