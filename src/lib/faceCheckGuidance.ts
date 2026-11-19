export function eyeStates(left: number, right: number) {
  return {
    open: left > 0.22 && right > 0.22,
    closed: left < 0.16 && right < 0.16 && left >= 0 && right >= 0,
  };
}

export function faceMoved(anchor: { x: number; y: number }, nose: { x: number; y: number }) {
  return Math.hypot(nose.x - anchor.x, nose.y - anchor.y) > 0.015;
}

export const BLINK_HOLD_MS = 400;

export function blinkHoldComplete(since: number, now: number) {
  return now - since >= BLINK_HOLD_MS;
}
