# ADR 0001: Hybrid mobile framework

- Status: Approved
- Date: 2026-04-15

## Context

CrewCue requires one mobile codebase for iOS and Android, with strong support for intermittent connectivity and BLE-assisted workflows.

## Decision

Use React Native with Expo (prebuild/EAS-ready) and TypeScript as the hybrid mobile stack.

## Rationale

- Single codebase across iOS and Android with mature ecosystem
- Strong TypeScript interoperability with backend/contracts packages
- Fast onboarding and release velocity through Expo toolchain
- BLE and offline support available via maintained community modules

## Consequences

- Some native modules require prebuild/native config steps
- Strict dependency governance is needed to avoid unsupported Expo packages
