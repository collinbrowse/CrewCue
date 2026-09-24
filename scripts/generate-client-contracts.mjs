#!/usr/bin/env node
/**
 * Regenerate Swift and Kotlin wire types from packages/contracts and fail if committed output drifted.
 * Pass --write to update the files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const allowlist = ["HealthStatus"];
const write = process.argv.includes("--write");

const program = ts.createProgram(
  [path.join(repoRoot, "packages/contracts/src/index.ts")],
  {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true
  }
);
const checker = program.getTypeChecker();
const source = program.getSourceFile(path.join(repoRoot, "packages/contracts/src/index.ts"));
if (!source) {
  console.error("contracts index missing");
  process.exit(1);
}

function findInterface(name) {
  let found;
  function visit(node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function swiftType(type) {
  if (type.flags & ts.TypeFlags.String || type.isStringLiteral?.()) return "String";
  if (type.flags & ts.TypeFlags.Number || type.flags & ts.TypeFlags.NumberLiteral) return "Double";
  if (type.flags & ts.TypeFlags.Boolean || type.flags & ts.TypeFlags.BooleanLiteral) return "Bool";
  if (type.isUnion()) {
    const parts = type.types.map(swiftType);
    if (parts.every((part) => part === "String")) return "String";
  }
  return "String";
}

function kotlinType(type) {
  const swift = swiftType(type);
  if (swift === "Double") return "Double";
  if (swift === "Bool") return "Boolean";
  return "String";
}

function render(name) {
  const node = findInterface(name);
  if (!node) throw new Error(`missing interface ${name}`);
  const type = checker.getTypeAtLocation(node);
  const props = type.getProperties().map((prop) => {
    const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
    const propType = checker.getTypeOfSymbolAtLocation(prop, declaration ?? node);
    return { name: prop.getName(), swift: swiftType(propType), kotlin: kotlinType(propType) };
  });
  const swiftFields = props
    .map((prop) => `    public var ${prop.name}: ${prop.swift}`)
    .join("\n");
  const swiftInitParams = props.map((prop) => `${prop.name}: ${prop.swift}`).join(", ");
  const swiftInitBody = props.map((prop) => `        self.${prop.name} = ${prop.name}`).join("\n");
  const swift = `// Generated from packages/contracts. Do not edit.
import Foundation

public struct ${name}: Codable, Equatable, Sendable {
${swiftFields}

    public init(${swiftInitParams}) {
${swiftInitBody}
    }
}
`;
  const kotlinParams = props.map((prop) => `    val ${prop.name}: ${prop.kotlin}`).join(",\n");
  const kotlin = `package com.crewcue.android.generated

data class ${name}(
${kotlinParams}
)
`;
  return { swift, kotlin };
}

const outputs = allowlist.map((name) => ({ name, ...render(name) }));
const swiftPath = path.join(
  repoRoot,
  "packages/client-core/Sources/CrewCueClientCore/Generated/HealthStatus.swift"
);
const kotlinPath = path.join(
  repoRoot,
  "apps/android/app/src/main/kotlin/com/crewcue/android/generated/HealthStatus.kt"
);

if (write) {
  fs.mkdirSync(path.dirname(swiftPath), { recursive: true });
  fs.mkdirSync(path.dirname(kotlinPath), { recursive: true });
  fs.writeFileSync(swiftPath, outputs[0].swift);
  fs.writeFileSync(kotlinPath, outputs[0].kotlin);
  console.log("verify:client-codegen wrote HealthStatus");
  process.exit(0);
}

const swiftChanged = fs.readFileSync(swiftPath, "utf8") !== outputs[0].swift;
const kotlinChanged = fs.readFileSync(kotlinPath, "utf8") !== outputs[0].kotlin;
if (swiftChanged || kotlinChanged) {
  console.error("verify:client-codegen failed: generated HealthStatus drifted. Re-run with --write.");
  process.exit(1);
}
console.log("verify:client-codegen passed");
