## Objective
Sample Ready body for harness unit tests.

## In-scope changes
- scripts/

## Out of scope
None for sample.

## Acceptance criteria
1. Parses as Ready

## Edge-case matrix
| ID | Scenario | Expected | Proof |
| --- | --- | --- | --- |
| EC1 | empty | fail | N/A sample |

## Fixtures
- this file

## Depends on
none

## Path conflict map
none

## Verification
- node --test scripts/agent-ready-parse.test.mjs
