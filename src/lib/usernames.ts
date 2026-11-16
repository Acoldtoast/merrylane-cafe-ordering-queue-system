export type AccountRole = "admin" | "staff";

export function usernameForAccount(name: string, role: AccountRole): string {
  const usernamePrefix =
    role === "admin" ? "admin" : name.trim().split(/\s+/)[0] || "";
  return `${usernamePrefix}-merrylane`.toLowerCase();
}
