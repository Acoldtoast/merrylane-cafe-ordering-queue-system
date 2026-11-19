export type CheckStatus = "pass" | "mismatch" | "unknown";

export type StaffIdExpirationState =
  | "not_required"
  | "missing"
  | "invalid"
  | "current"
  | "expires_today"
  | "expired";

const staffIdTypesWithExpiration = new Set([
  "drivers_license",
  "passport",
  "postal",
]);

export function staffIdRequiresExpirationDate(type: string): boolean {
  return staffIdTypesWithExpiration.has(type);
}

export function isValidStaffIdDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function staffIdToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function staffIdExpirationState(
  value: string,
  type: string,
  today = staffIdToday()
): StaffIdExpirationState {
  if (!value) {
    return staffIdRequiresExpirationDate(type) ? "missing" : "not_required";
  }
  if (!isValidStaffIdDate(value)) return "invalid";
  if (value < today) return "expired";
  if (value === today) return "expires_today";
  return "current";
}

export function checkStaffIdExpiration(
  value: string,
  type: string,
  today = staffIdToday()
): CheckStatus {
  const state = staffIdExpirationState(value, type, today);
  if (state === "missing") return "unknown";
  return state === "expired" || state === "invalid" ? "mismatch" : "pass";
}

export function staffIdExpirationWarning(
  value: string,
  type: string,
  today = staffIdToday()
): "missing" | "invalid" | "expired" | "expires_soon" | null {
  const state = staffIdExpirationState(value, type, today);
  if (state === "missing") return "missing";
  if (state === "invalid") return "invalid";
  if (state === "expired") return "expired";
  if (state !== "current" && state !== "expires_today") return null;
  const daysUntilExpiration =
    (Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
    86_400_000;
  return daysUntilExpiration <= 30 ? "expires_soon" : null;
}

export function checkStaffIdBirthDate(
  value: string,
  today = staffIdToday()
): CheckStatus {
  if (!value) return "pass";
  if (!isValidStaffIdDate(value) || value >= today) return "mismatch";
  return "pass";
}

export function isStaffIdentityScanVerified(
  idOutcome: string | undefined,
  faceMatch: string | undefined
): boolean {
  return idOutcome === "match" && faceMatch === "matched";
}

export function checkStaffIdName(idName: string, staffName: string): CheckStatus {
  const words = (value: string): string[] => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().match(/[A-Z]+/g) ?? [];
  const expected = words(staffName);
  const actual = words(idName);
  if (expected.length < 2 || actual.length < 2) return "unknown";
  return actual.includes(expected[0]) && actual.includes(expected[expected.length - 1]) ? "pass" : "mismatch";
}

export function checkStaffIdNumber(value: string, type: string): CheckStatus {
  if (!value.trim()) return "unknown";
  const number = value.toUpperCase().replace(/[\s\-–—_]/g, "");
  const rules: Record<string, RegExp> = {
    philsys: /^\d{16}$/,
    drivers_license: /^(?=.*\d)[A-Z0-9]{8,14}$/,
    passport: /^[A-Z]\d{6,8}[A-Z]?$/,
    voter: /^(?=.*\d)[A-Z0-9]{6,20}$/,
  };
  const rule = rules[type];
  if (rule) return rule.test(number) ? "pass" : "mismatch";
  if (!["postal", "philhealth", "other"].includes(type)) return "unknown";
  return /^[A-Z0-9]{4,24}$/.test(number) ? "pass" : "mismatch";
}

export type StaffIdDetails = {
  name: string;
  number: string;
  birth_date: string;
  expiration_date: string;
};

export type StaffIdDetailsChecks = {
  name: CheckStatus;
  number: CheckStatus;
  birth_date: CheckStatus;
  expiration_date: CheckStatus;
};

export function checkStaffIdDetails(
  details: StaffIdDetails,
  staffName: string,
  type: string
): StaffIdDetailsChecks {
  return {
    name: checkStaffIdName(details.name, staffName),
    number: checkStaffIdNumber(details.number, type),
    birth_date: checkStaffIdBirthDate(details.birth_date),
    expiration_date: checkStaffIdExpiration(details.expiration_date, type),
  };
}

export function areStaffIdDetailsPassing(checks: StaffIdDetailsChecks): boolean {
  return Object.values(checks).every((status) => status === "pass");
}
