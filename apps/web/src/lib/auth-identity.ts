const LOCAL_AUTH_DOMAIN = "astronom.local";

/** Demo password user. Created with email_confirm so no verification mail is sent. */
export const DEMO_LOGIN = {
  username: "testuser",
  password: "astronomtest",
  name: "Test User",
} as const;

export function emailFromLogin(usernameOrEmail: string): string {
  const value = usernameOrEmail.trim().toLowerCase();
  if (!value) return "";
  if (value.includes("@")) return value;
  return `${value}@${LOCAL_AUTH_DOMAIN}`;
}
