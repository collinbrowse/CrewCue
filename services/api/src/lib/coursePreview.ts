import { buildRaceCourseFromGpx, parseGpxTrack, parsedTrackToWorkspaceLayer } from "@crewcue/map-core";

/** Server-side GPX parse. Clients upload the file; they do not reimplement course geometry. */
export function coursePreviewFromGpx(gpxXml: string, courseFileName: string) {
  const parsed = parseGpxTrack(gpxXml);
  const built = buildRaceCourseFromGpx(parsed);
  return {
    course: built.course,
    plannedPaceSecondsPerKm: built.plannedPaceSecondsPerKm,
    routeOverlayLayer: parsedTrackToWorkspaceLayer(courseFileName, parsed),
    courseFileName
  };
}

export type CoursePreview = ReturnType<typeof coursePreviewFromGpx>;
