export const DEFAULT_NOTICE_SWIPE_DISMISS_DY = -48;
export const DEFAULT_NOTICE_SWIPE_DISMISS_VY = -0.45;

/** True when an upward swipe should dismiss the transient notice banner. */
export function shouldDismissTransientBySwipe(
  dy: number,
  vy: number,
  options?: { dismissDy?: number; dismissVy?: number }
): boolean {
  const dismissDy = options?.dismissDy ?? DEFAULT_NOTICE_SWIPE_DISMISS_DY;
  const dismissVy = options?.dismissVy ?? DEFAULT_NOTICE_SWIPE_DISMISS_VY;
  return dy <= dismissDy || vy <= dismissVy;
}
