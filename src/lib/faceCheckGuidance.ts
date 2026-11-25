/*
 * Eye state comes from MediaPipe blendshape coefficients, not eyelid landmark
 * distances. The ratios left a 0.16-0.22 band that was neither open nor closed,
 * so a resting face behind glasses or in low light could sit in it forever.
 * Blendshape scores run 0 (open) to 1 (closed) and separate cleanly.
 */
export const EYES_OPEN_MAX_SCORE = 0.3;
export const EYES_CLOSED_MIN_SCORE = 0.55;

export function eyeStates(leftBlinkScore: number, rightBlinkScore: number) {
  return {
    open:
      leftBlinkScore < EYES_OPEN_MAX_SCORE &&
      rightBlinkScore < EYES_OPEN_MAX_SCORE,
    closed:
      leftBlinkScore > EYES_CLOSED_MIN_SCORE &&
      rightBlinkScore > EYES_CLOSED_MIN_SCORE,
  };
}

/** Read the two blink coefficients from one face's blendshape categories. */
export function blinkScores(
  categories: readonly { categoryName: string; score: number }[] | undefined
) {
  const score = (name: string) => {
    const value = categories?.find(
      (category) => category.categoryName === name
    )?.score;
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  return { left: score("eyeBlinkLeft"), right: score("eyeBlinkRight") };
}

/*
 * Face++ requires a turn of at least 15 degrees, measured from the frontal
 * frame. The client asks for 20 so a captured frame clears the provider's
 * check with margin instead of being accepted on screen and rejected on the
 * server.
 */
export const TURN_ACCEPT_DEGREES = 20;
export const FRONT_MAX_DEGREES = 15;

/** Head yaw in degrees from MediaPipe's facial transformation matrix. */
export function headYawDegrees(
  matrix: { data: ArrayLike<number> } | undefined
): number | undefined {
  const data = matrix?.data;
  if (!data || data.length < 16) return undefined;
  /*
   * Only the magnitude is used by callers, and a row-major read of this matrix
   * flips the sign while leaving |yaw| unchanged, so the threshold holds whether
   * the layout is column-major or row-major.
   */
  const yaw = (Math.atan2(data[8], data[10]) * 180) / Math.PI;
  return Number.isFinite(yaw) ? yaw : undefined;
}

export function facingForward(yaw: number | undefined): boolean {
  return yaw === undefined || Math.abs(yaw) <= FRONT_MAX_DEGREES;
}

export function turnAccepted(
  yaw: number | undefined,
  frontYaw: number | undefined
): boolean {
  if (yaw === undefined) return true;
  if (Math.abs(yaw) < TURN_ACCEPT_DEGREES) return false;
  return frontYaw === undefined || Math.abs(yaw - frontYaw) >= TURN_ACCEPT_DEGREES;
}

export function faceMoved(anchor: { x: number; y: number }, nose: { x: number; y: number }) {
  return Math.hypot(nose.x - anchor.x, nose.y - anchor.y) > 0.015;
}

/*
 * Drift allowed during the blink step. It is wider than the head-turn gate
 * because a blink takes several seconds: a small shift of weight must not
 * invalidate a blink the person already performed correctly.
 */
export const BLINK_DRIFT_DISTANCE = 0.045;
export const BLINK_DRIFT_TURN = 0.08;

export function blinkDrifted(
  anchor: { x: number; y: number; turn: number },
  nose: { x: number; y: number },
  turn: number
) {
  return (
    Math.hypot(nose.x - anchor.x, nose.y - anchor.y) > BLINK_DRIFT_DISTANCE ||
    Math.abs(turn - anchor.turn) > BLINK_DRIFT_TURN
  );
}

export const BLINK_HOLD_MS = 400;

export function blinkHoldComplete(since: number, now: number) {
  return now - since >= BLINK_HOLD_MS;
}
