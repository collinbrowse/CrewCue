export type UserLocateVisual = "default" | "locating" | "latched";

export type LocateVisualEvent =
  | { type: "press" }
  | { type: "success" }
  | { type: "failure" }
  | { type: "skipped" }
  | { type: "aborted" };

/** Pure state machine for the map "my location" control affordance. */
export function nextUserLocateVisual(
  current: UserLocateVisual,
  event: LocateVisualEvent
): UserLocateVisual {
  switch (event.type) {
    case "press":
      return "locating";
    case "success":
      return "latched";
    case "failure":
      return "default";
    case "skipped":
      return current === "locating" ? "default" : current;
    case "aborted":
      return current;
    default:
      return current;
  }
}
