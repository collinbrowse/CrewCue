#!/usr/bin/env node
/**
 * Regenerate Swift and Kotlin wire types from packages/contracts and fail if committed output drifted.
 * Pass --write to update the files.
 *
 * Nested object unions and a few oversized fields are omitted so Codable matches JSON the API actually returns.
 * Unknown JSON keys are ignored by the generated structs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = [
  "HealthStatus",
  "RaceRoomMembership",
  "RaceRoomEntitlement",
  "RaceCourseCheckpoint",
  "RaceCourseBaselinePoint",
  "RaceCourseBaselineTrack",
  "RaceCourse",
  "RaceRoom",
  "RaceRoomJoinPreviewMember",
  "RaceRoomJoinPreviewCheckpoint",
  "RaceRoomJoinPreview",
  "ScheduleStopNotesRef",
  "ScheduleStop",
  "CrewScheduleSheet",
  "PacingAidEta",
  "PacingTimePoint",
  "PacingEstimate",
  "AthletePingIngestPayload",
  "IncidentEvent",
  "ChatStreamTokenResponse",
  "RaceRoomInvite"
];
const skipProperties = new Set([
  "courseGpxXml",
  "mapWorkspace",
  "stopPlans",
  "bands",
  "cutoff",
  "payload"
]);
const write = process.argv.includes("--write");

const program = ts.createProgram(
  [
    path.join(repoRoot, "packages/contracts/src/index.ts"),
    path.join(repoRoot, "packages/contracts/src/pacingSchedule.ts")
  ],
  {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true
  }
);
const checker = program.getTypeChecker();

function findInterface(name) {
  for (const source of program.getSourceFiles()) {
    if (source.isDeclarationFile) continue;
    let found;
    function visit(node) {
      if (ts.isInterfaceDeclaration(node) && node.name.text === name) found = node;
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (found) return found;
  }
  return undefined;
}

function isStringish(type) {
  return (
    Boolean(type.flags & ts.TypeFlags.String) ||
    Boolean(type.flags & ts.TypeFlags.StringLiteral) ||
    type.isStringLiteral?.()
  );
}

function isNumberish(type) {
  return Boolean(type.flags & ts.TypeFlags.Number) || Boolean(type.flags & ts.TypeFlags.NumberLiteral);
}

function isBoolish(type) {
  return Boolean(type.flags & ts.TypeFlags.Boolean) || Boolean(type.flags & ts.TypeFlags.BooleanLiteral);
}

function interfaceName(type) {
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  const name = symbol?.getName();
  if (!name || name === "__type" || name === "__object") return undefined;
  if (findInterface(name)) return name;
  return undefined;
}

/**
 * @returns {{ swift: string, kotlin: string, deps: string[] } | undefined}
 */
function renderType(type) {
  if (isStringish(type)) return { swift: "String", kotlin: "String", deps: [] };
  if (isNumberish(type)) return { swift: "Double", kotlin: "Double", deps: [] };
  if (isBoolish(type)) return { swift: "Bool", kotlin: "Boolean", deps: [] };
  if (type.isUnion()) {
    const parts = type.types.filter(
      (part) =>
        !(part.flags & ts.TypeFlags.Undefined) &&
        !(part.flags & ts.TypeFlags.Null) &&
        !(part.flags & ts.TypeFlags.Void)
    );
    if (parts.length === 1) return renderType(parts[0]);
    if (parts.every((part) => isStringish(part))) return { swift: "String", kotlin: "String", deps: [] };
    return undefined;
  }
  if (checker.isArrayType(type)) {
    const element = checker.getElementTypeOfArrayType(type) ?? type.getNumberIndexType();
    if (!element) return undefined;
    const rendered = renderType(element);
    if (!rendered) return undefined;
    return {
      swift: `[${rendered.swift}]`,
      kotlin: `List<${rendered.kotlin}>`,
      deps: rendered.deps
    };
  }
  const named = interfaceName(type);
  if (named) return { swift: named, kotlin: named, deps: [named] };
  return undefined;
}

function renderStruct(name) {
  const node = findInterface(name);
  if (!node) throw new Error(`missing interface ${name}`);
  const type = checker.getTypeAtLocation(node);
  const deps = new Set();
  const fields = [];
  for (const prop of type.getProperties()) {
    if (skipProperties.has(prop.getName())) continue;
    const declaration = prop.valueDeclaration ?? prop.declarations?.[0];
    if (!declaration) continue;
    const propType = checker.getTypeOfSymbolAtLocation(prop, declaration);
    const optional = Boolean(prop.flags & ts.SymbolFlags.Optional);
    const rendered = renderType(propType);
    if (!rendered) {
      console.error(`verify:client-codegen skipped ${name}.${prop.getName()}`);
      continue;
    }
    for (const dep of rendered.deps) deps.add(dep);
    fields.push({
      name: prop.getName(),
      swift: rendered.swift + (optional ? "?" : ""),
      kotlin: rendered.kotlin + (optional ? "?" : ""),
      optional
    });
  }
  if (fields.length === 0) throw new Error(`${name} generated no fields`);
  const swiftFields = fields.map((field) => `    public var ${field.name}: ${field.swift}`).join("\n");
  const swiftInitParams = fields
    .map((field) => `${field.name}: ${field.swift}${field.optional ? " = nil" : ""}`)
    .join(", ");
  const swiftInitBody = fields.map((field) => `        self.${field.name} = ${field.name}`).join("\n");
  const swift = `// Generated from packages/contracts. Do not edit.
import Foundation

public struct ${name}: Codable, Equatable, Sendable {
${swiftFields}

    public init(${swiftInitParams}) {
${swiftInitBody}
    }
}
`;
  const kotlinParams = fields
    .map((field) => `    val ${field.name}: ${field.kotlin}${field.optional ? " = null" : ""}`)
    .join(",\n");
  const kotlin = `package com.crewcue.android.generated

data class ${name}(
${kotlinParams}
)
`;
  return { swift, kotlin, deps: [...deps] };
}

const order = [];
const seen = new Set();
function visit(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const rendered = renderStruct(name);
  for (const dep of rendered.deps) visit(dep);
  order.push({ name, ...rendered });
}
for (const name of roots) visit(name);

const swiftDir = path.join(repoRoot, "packages/client-core/Sources/CrewCueClientCore/Generated");
const kotlinDir = path.join(repoRoot, "apps/android/app/src/main/kotlin/com/crewcue/android/generated");

if (write) {
  fs.mkdirSync(swiftDir, { recursive: true });
  fs.mkdirSync(kotlinDir, { recursive: true });
  for (const item of order) {
    fs.writeFileSync(path.join(swiftDir, `${item.name}.swift`), item.swift);
    fs.writeFileSync(path.join(kotlinDir, `${item.name}.kt`), item.kotlin);
  }
  console.log(`verify:client-codegen wrote ${order.length} types`);
  process.exit(0);
}

const errors = [];
for (const item of order) {
  const swiftPath = path.join(swiftDir, `${item.name}.swift`);
  const kotlinPath = path.join(kotlinDir, `${item.name}.kt`);
  if (!fs.existsSync(swiftPath) || fs.readFileSync(swiftPath, "utf8") !== item.swift) {
    errors.push(`${item.name}.swift`);
  }
  if (!fs.existsSync(kotlinPath) || fs.readFileSync(kotlinPath, "utf8") !== item.kotlin) {
    errors.push(`${item.name}.kt`);
  }
}
if (errors.length) {
  console.error(`verify:client-codegen failed: generated output drifted (${errors.join(", ")}). Re-run with --write.`);
  process.exit(1);
}
console.log(`verify:client-codegen passed (${order.length} types)`);
