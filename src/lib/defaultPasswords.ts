/**
 * Passwords the school hands out (new accounts, admin resets). Anyone signing
 * in with one of these must choose a new password, and none of them can be
 * chosen as the new password.
 */
export const DEFAULT_PASSWORDS = new Set([
  "gracemark",
  "gracemark2026!",
  "student123",
  "teacher123",
  "student",
  "password",
  "password123",
  "123456",
  "12345678",
]);

export function isDefaultPassword(password: string): boolean {
  const clean = String(password || "").trim();
  return DEFAULT_PASSWORDS.has(clean.toLowerCase()) || clean.startsWith("Gma@");
}
