/**
 * Status words for staff ID checks, mirroring the other system's badges:
 * pass → Passed, warn → Check, fail → Problem, unknown → Not checked.
 */
export type StaffIdCheckTone = "pass" | "check" | "problem" | "unknown";

export function staffIdCheckLabel(tone: StaffIdCheckTone): string {
  switch (tone) {
    case "pass":
      return "Passed";
    case "check":
      return "Check";
    case "problem":
      return "Problem";
    default:
      return "Not checked";
  }
}

export function staffIdDuplicateTone(
  state: "idle" | "checking" | "unique" | "duplicate" | "unavailable"
): StaffIdCheckTone {
  if (state === "unique") return "pass";
  if (state === "duplicate") return "problem";
  if (state === "checking") return "check";
  return "unknown";
}
