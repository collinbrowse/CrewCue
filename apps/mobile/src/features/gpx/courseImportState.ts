import type { RaceCourse } from "@crewcue/contracts";
import { formatDistance, type DistanceUnit } from "./gpxImport";

export type CourseImportState =
  | { status: "idle" }
  | { status: "picking" }
  | {
      status: "calculating";
      fileName: string;
      ratio: number;
      message: string;
    }
  | {
      status: "success";
      fileName: string;
      totalDistanceLabel: string;
      elevationLabel: string;
    }
  | { status: "error"; message: string };

export type CourseImportSuccessState = Extract<CourseImportState, { status: "success" }>;

export type PendingCourseImportSummary = {
  fileName: string;
  totalDistanceMeters: number;
  elevationGainMeters: number;
};

export function shouldPreserveLocalImportStateOnHydrate(
  current: CourseImportState,
  pendingCourseUpload: PendingCourseImportSummary | undefined
): boolean {
  if (
    current.status === "picking" ||
    current.status === "calculating" ||
    current.status === "error"
  ) {
    return true;
  }
  return pendingCourseUpload !== undefined && current.status === "success";
}

export function selectVisibleCourseImportState({
  pendingCourseUpload,
  importState,
  persistedCourseState,
  unit
}: {
  pendingCourseUpload?: PendingCourseImportSummary;
  importState: CourseImportState;
  persistedCourseState?: CourseImportSuccessState;
  unit: DistanceUnit;
}): CourseImportSuccessState | undefined {
  if (pendingCourseUpload) {
    return {
      status: "success",
      fileName: pendingCourseUpload.fileName,
      totalDistanceLabel: formatDistance(pendingCourseUpload.totalDistanceMeters, unit),
      elevationLabel: formatElevationGainFromMeters(pendingCourseUpload.elevationGainMeters)
    };
  }
  if (importState.status === "success") {
    return importState;
  }
  return persistedCourseState;
}

export function buildImportStateFromCourse({
  fileName,
  course,
  storedDistanceMeters,
  storedElevationGainMeters,
  unit
}: {
  fileName: string;
  course?: RaceCourse;
  storedDistanceMeters?: number;
  storedElevationGainMeters?: number;
  unit: DistanceUnit;
}): CourseImportSuccessState {
  const totalDistanceMeters =
    storedDistanceMeters ?? course?.baselineTrack?.points?.[course.baselineTrack.points.length - 1]?.distanceMetersFromStart ?? 0;
  return {
    status: "success",
    fileName,
    totalDistanceLabel: formatDistance(totalDistanceMeters, unit),
    elevationLabel: formatElevationGainFromMeters(storedElevationGainMeters)
  };
}

export function formatElevationGainFromMeters(gainMeters: number | undefined): string {
  if (typeof gainMeters !== "number" || !Number.isFinite(gainMeters)) {
    return "Vert --";
  }
  if (gainMeters <= 0) {
    return "0 ft gain";
  }
  const gainFeet = Math.round(gainMeters * 3.28084);
  return `${gainFeet.toLocaleString()} ft gain`;
}
