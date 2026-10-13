import test from "node:test";
import assert from "node:assert/strict";
import {
  isAuthedTabDeepLinkPath,
  isRetiredCourseSchedulePath,
  mapAidSheetExpandNavigationState,
  pathFromCrewCueUrl
} from "./linkingPaths";

test("pathFromCrewCueUrl parses crewcue scheme paths", () => {
  assert.equal(pathFromCrewCueUrl("crewcue://guest"), "guest");
  assert.equal(pathFromCrewCueUrl("crewcue://chat"), "chat");
  assert.equal(pathFromCrewCueUrl("crewcue://map/navigate"), "map/navigate");
  assert.equal(pathFromCrewCueUrl("crewcue://course/schedule"), "course/schedule");
  assert.equal(pathFromCrewCueUrl("crewcue://dev/schedule-sheet"), "dev/schedule-sheet");
  assert.equal(pathFromCrewCueUrl("crewcue://dev/crew-sheet-export"), "dev/crew-sheet-export");
  assert.equal(pathFromCrewCueUrl("crewcue://dev/cold-start"), "dev/cold-start");
  assert.equal(pathFromCrewCueUrl("crewcue://dev/pace-estimate"), "dev/pace-estimate");
  assert.equal(pathFromCrewCueUrl("crewcue://dev/gpx-import-progress"), "dev/gpx-import-progress");
  assert.equal(pathFromCrewCueUrl("crewcue://course/dev-gpx-import-progress"), "course/dev-gpx-import-progress");
  assert.equal(pathFromCrewCueUrl("crewcue://strava?code=x&state=y"), "strava");
  assert.equal(pathFromCrewCueUrl("crewcue://chat?x=1"), "chat");
});

test("course/schedule rewrites to Map aid sheet expand (no Pace ScheduleSheet)", () => {
  assert.equal(isRetiredCourseSchedulePath("course/schedule"), true);
  assert.equal(isRetiredCourseSchedulePath("/course/schedule/"), true);
  assert.equal(isRetiredCourseSchedulePath("course/schedule?x=1"), true);
  assert.equal(isRetiredCourseSchedulePath("course/settings"), false);
  const state = mapAidSheetExpandNavigationState();
  assert.equal(state.routes[0]?.name, "Map");
  assert.equal(state.routes[0]?.state?.routes[0]?.name, "MapHome");
  assert.equal(state.routes[0]?.state?.routes[0]?.params?.expandSheet, true);
  assert.equal(JSON.stringify(state).includes("ScheduleSheet"), false);
  assert.equal(JSON.stringify(state).includes("Pace"), false);
});

test("isAuthedTabDeepLinkPath recognizes tab roots only", () => {
  assert.equal(isAuthedTabDeepLinkPath("chat"), true);
  assert.equal(isAuthedTabDeepLinkPath("map/navigate"), true);
  assert.equal(isAuthedTabDeepLinkPath("guest"), false);
  assert.equal(isAuthedTabDeepLinkPath("strava"), false);
  assert.equal(isAuthedTabDeepLinkPath("dev/schedule-sheet"), false);
  assert.equal(isAuthedTabDeepLinkPath("dev/crew-sheet-export"), false);
  assert.equal(isAuthedTabDeepLinkPath("dev/cold-start"), false);
  assert.equal(isAuthedTabDeepLinkPath("dev/pace-estimate"), false);
  assert.equal(isAuthedTabDeepLinkPath("dev/gpx-import-progress"), false);
});
