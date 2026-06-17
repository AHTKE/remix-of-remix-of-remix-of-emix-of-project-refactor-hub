function getSafeSessionPassword() {
  const raw = process.env.SESSION_SECRET || "amw-default-session-secret";
  return raw.length >= 32
    ? raw
    : `${raw}:telegram-code-buddy-admin-session-secret-v1`;
}

export function getSessionConfig() {
  return {
    password: getSafeSessionPassword(),
    name: "amw_admin_session",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
    },
  };
}

export type SessionData = { isAdmin?: boolean };
