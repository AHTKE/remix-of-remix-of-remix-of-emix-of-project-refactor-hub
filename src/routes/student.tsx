import { createFileRoute, Link, Outlet, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { studentLogout, studentStatus } from "@/lib/student.functions";

export const Route = createFileRoute("/student")({
  ssr: false,
  component: StudentLayout,
});

const NAV: Array<{ to: string; icon: string; label: string }> = [
  { to: "/student", icon: "🏠", label: "الرئيسية" },
  { to: "/student/courses", icon: "📚", label: "كورساتي" },
  { to: "/student/homework", icon: "📝", label: "الواجبات" },
  { to: "/student/quizzes", icon: "🧪", label: "الامتحانات" },
  { to: "/student/wallet", icon: "💰", label: "المحفظة" },
  { to: "/student/notifications", icon: "🛎️", label: "الإشعارات" },
  { to: "/student/activity", icon: "📑", label: "النشاط" },
  { to: "/student/support", icon: "🆘", label: "الدعم" },
  { to: "/student/profile", icon: "👤", label: "حسابي" },
];

function StudentLayout() {
  const navigate = useNavigate();
  const router = useRouter();
  const logoutFn = useServerFn(studentLogout);
  const [open, setOpen] = useState(false);
  const me = useQuery({
    queryKey: ["student-me"],
    queryFn: () => studentStatus(),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!me.isLoading && me.data && !me.data.loggedIn) {
      navigate({ to: "/login" });
    } else if (!me.isLoading && me.data?.loggedIn && me.data.student.banned) {
      // Allow viewing /student/blocked and /student/support only.
      const path = router.state.location.pathname;
      if (!path.startsWith("/student/blocked") && !path.startsWith("/student/support")) {
        navigate({ to: "/student/blocked" });
      }
    }
  }, [me.isLoading, me.data, router.state.location.pathname]);

  if (me.isLoading) {
    return <div dir="rtl" className="min-h-screen flex items-center justify-center text-muted-foreground">جاري التحميل...</div>;
  }
  if (!me.data?.loggedIn) return null;
  const student = me.data.student;

  return (
    <div dir="rtl" className="min-h-screen flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex w-64 flex-col border-l border-border bg-card/40 backdrop-blur-xl sticky top-0 h-screen p-5">
        <Link to="/student" className="flex items-center gap-2 font-bold mb-6">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg brand-gradient text-primary-foreground">A</span>
          <span className="text-gradient">AMW · LMS</span>
        </Link>
        <nav className="flex-1 space-y-1">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to as any}
              activeOptions={{ exact: n.to === "/student" }}
              activeProps={{ className: "bg-primary/15 text-primary border border-primary/30" }}
              inactiveProps={{ className: "hover:bg-secondary/50 border border-transparent" }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition"
            >
              <span className="text-lg">{n.icon}</span>
              <span>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t border-border pt-4 mt-4">
          <div className="px-3 py-2 text-xs">
            <div className="font-semibold">{student.first_name || "طالب"}</div>
            <div className="text-muted-foreground font-mono">{student.student_code}</div>
            <div className="mt-1 text-primary">💰 {student.wallet_balance} ج</div>
          </div>
          <button
            onClick={async () => { await logoutFn(); await router.invalidate(); navigate({ to: "/login" }); }}
            className="w-full mt-2 text-right px-3 py-2 rounded-lg text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition"
          >
            🚪 تسجيل خروج
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/student" className="flex items-center gap-2 font-bold">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg brand-gradient text-primary-foreground text-sm">A</span>
            <span className="text-gradient text-sm">AMW · LMS</span>
          </Link>
          <button
            onClick={() => setOpen(!open)}
            className="p-2 rounded-lg bg-secondary/60"
          >☰</button>
        </div>
        {open && (
          <nav className="px-4 pb-3 space-y-1 border-t border-border">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to as any}
                onClick={() => setOpen(false)}
                activeOptions={{ exact: n.to === "/student" }}
                activeProps={{ className: "bg-primary/15 text-primary" }}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm"
              >
                <span>{n.icon}</span><span>{n.label}</span>
              </Link>
            ))}
            <button
              onClick={async () => { await logoutFn(); await router.invalidate(); navigate({ to: "/login" }); }}
              className="w-full text-right px-3 py-2 rounded-lg text-sm text-destructive"
            >🚪 تسجيل خروج</button>
          </nav>
        )}
      </div>

      <main className="flex-1 min-w-0 md:pt-0 pt-14">
        <Outlet />
      </main>
    </div>
  );
}
