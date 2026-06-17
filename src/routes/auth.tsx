import { createFileRoute, redirect } from "@tanstack/react-router";

// Legacy admin-only login page — now unified with /login (which has a teacher tab).
export const Route = createFileRoute("/auth")({
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
