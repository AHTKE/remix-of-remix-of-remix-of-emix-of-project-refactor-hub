import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { adminLogout, adminStatus } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: async () => {
    const { isAdmin } = await adminStatus();
    if (!isAdmin) throw redirect({ to: "/auth" });
  },
  component: AdminLayout,
});

function AdminLayout() {
  const logout = useServerFn(adminLogout);
  const router = useRouter();
  const navigate = useNavigate();

  async function doLogout() {
    await logout();
    await router.invalidate();
    navigate({ to: "/auth" });
  }

  return (
    <div dir="rtl" className="min-h-screen text-foreground">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/70 border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4 lg:gap-8 min-w-0 flex-1 flex-wrap">
            <Link to="/admin" className="flex items-center gap-2 font-bold text-lg whitespace-nowrap">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg brand-gradient text-primary-foreground">
                A
              </span>
              <span className="text-gradient">AMW · LMS</span>
            </Link>
            <nav className="flex items-center gap-1 text-sm overflow-x-auto max-w-full pb-1">
              {[
                { to: "/admin", label: "نظرة عامة", exact: true },
                { to: "/admin/courses", label: "الكورسات" },
                { to: "/admin/vouchers", label: "الأكواد" },
                { to: "/admin/polls", label: "التصويتات" },
                { to: "/admin/quizzes", label: "الامتحانات" },
                { to: "/admin/homework", label: "الواجبات" },
                { to: "/admin/students", label: "الطلاب" },
                { to: "/admin/wallet", label: "المحفظة" },
                { to: "/admin/support", label: "الدعم" },
                { to: "/admin/books", label: "المكتبة" },
                { to: "/admin/broadcast", label: "الإعلانات" },
                { to: "/admin/analytics", label: "التحليلات" },
                { to: "/admin/faq", label: "FAQ" },
                { to: "/admin/settings", label: "الإعدادات" },
              ].map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={item.exact ? { exact: true } : undefined}
                  className="px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/60 [&.active]:text-foreground [&.active]:bg-secondary [&.active]:shadow-sm"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <button
            onClick={doLogout}
            className="text-sm text-muted-foreground hover:text-destructive transition"
          >
            خروج
          </button>
        </div>
      </header>
       <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
