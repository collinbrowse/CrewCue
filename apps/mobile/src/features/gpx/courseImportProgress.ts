/**
 * Progress copy/stages for on-device course file import → race splits.
 */

export type CourseImportProgressStage = "reading" | "parsing" | "calculating";

export const COURSE_IMPORT_PROGRESS: Record<
  CourseImportProgressStage,
  { ratio: number; message: string }
> = {
  reading: { ratio: 0.2, message: "Reading route file…" },
  parsing: { ratio: 0.55, message: "Parsing course track…" },
  calculating: { ratio: 0.85, message: "Calculating race splits…" }
};

/** Let React paint the progress bar before sync GPX work blocks the JS thread. */
export function yieldForCourseImportPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}
