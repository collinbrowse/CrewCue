import test from "node:test";
import assert from "node:assert/strict";
import { isAuthedTabDeepLinkPath, pathFromCrewCueUrl } from "./linkingPaths";

test("pathFromCrewCueUrl parses crewcue scheme paths", () => {
  assert.equal(pathFromCrewCueUrl("crewcue://guest"), "guest");
  assert.equal(pathFromCrewCueUrl("crewcue://chat"), "chat");
  assert.equal(pathFromCrewCueUrl("crewcue://map/navigate"), "map/navigate");
  assert.equal(pathFromCrewCueUrl("crewcue://course/schedule"), "course/schedule");
  assert.equal(pathFromCrewCueUrl("crewcue://dev/schedule-sheet"), "dev/schedule-sheet");
  assert.equal(pathFromCrewCueUrl("crewcue://dev/cold-start"), "dev/cold-start");
  assert.equal(pathFromCrewCueUrl("crewcue://chat?x=1"), "chat");
});

test("isAuthedTabDeepLinkPath recognizes tab roots only", () => {
  assert.equal(isAuthedTabDeepLinkPath("chat"), true);
  assert.equal(isAuthedTabDeepLinkPath("map/navigate"), true);
  assert.equal(isAuthedTabDeepLinkPath("guest"), false);
  assert.equal(isAuthedTabDeepLinkPath("dev/schedule-sheet"), false);
  assert.equal(isAuthedTabDeepLinkPath("dev/cold-start"), false);
});
