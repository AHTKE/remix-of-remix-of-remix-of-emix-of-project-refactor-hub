import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getStudentDashboard } from "@/lib/student.functions";

export const Route = createFileRoute("/student/")({
  component: Dashboard,
});

type CardDef = {
  to: string;
  title: string;
  desc: string;
  icon: string;
  gradient: string;
  ring: string;
  badge?: (d: any) => number | string | null;
};

const CARDS: CardDef[] = [
  {
    to: "/student/courses",
    title: "💡 الحصص والكورسات",
    desc: "شاهد دروسك وتقدّم في الكورس",
    icon: "🎬",
    gradient: "from-blue-500 to-indigo-600",
    ring: "ring-blue-300/40",
    badge: (d) => d?.active_courses?.length || null,
  },
  {
    to: "/student/quizzes",
    title: "🧪 الامتحانات",
    desc: "اختبر نفسك بعد كل حصة",
    icon: "📝",
    gradient: "from-purple-500 to-fuchsia-600",
    ring: "ring-purple-300/40",
    badge: (d) => d?.attempts_count || null,
  },
  {
    to: "/student/homework",
    title: "🧾 الواجبات",
    desc: "سلّم واجباتك واستلم التصحيح",
    icon: "📤",
    gradient: "from-orange-500 to-amber-600",
    ring: "ring-orange-300/40",
    badge: (d) => d?.homework_count || null,
  },
  {
    to: "/student/wallet",
    title: "💳 المحفظة",
    desc: "اشحن رصيدك وفعّل الأكواد",
    icon: "💎",
    gradient: "from-indigo-500 to-violet-600",
    ring: "ring-indigo-300/40",
    badge: (d) => (d?.student?.wallet_balance ? `${d.student.wallet_balance} ج` : null),
  },
  {
    to: "/student/support",
    title: "🛠️ الدعم الفني",
    desc: "تواصل مع فريق الدعم",
    icon: "💬",
    gradient: "from-green-500 to-emerald-600",
    ring: "ring-green-300/40",
  },
  {
    to: "/student/notifications",
    title: "🛎️ الإشعارات",
    desc: "الرسائل والتحديثات",
    icon: "🔔",
    gradient: "from-rose-500 to-red-600",
    ring: "ring-rose-300/40",
    badge: (d) => d?.unread_notifications || null,
  },
  {
    to: "/student/activity",
    title: "📑 سجل النشاط",
    desc: "تتبع تقدمك وإنجازاتك",
    icon: "📊",
    gradient: "from-teal-500 to-cyan-600",
    ring: "ring-teal-300/40",
  },
  {
    to: "/student/profile",
    title: "👤 الحساب الشخصي",
    desc: "عدّل بياناتك ومعلومات ولي الأمر",
    icon: "⚙️",
    gradient: "from-yellow-500 to-orange-500",
    ring: "ring-yellow-300/40",
  },
];

const GRADE_LABEL: Record<string, string> = {
  g1: "الصف الأول الثانوي",
  g2: "الصف الثاني الثانوي",
  g3: "الصف الثالث الثانوي",
};

function Dashboard() {
  const q = useQuery({
    queryKey: ["student-dashboard"],
    queryFn: () => getStudentDashboard(),
    staleTime: 30_000,
  });

  const d = q.data;
  const student = d?.student;

  return (
    <div className="relative max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-10 space-y-8">
      {/* Hero */}
      <header className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/15 via-card to-secondary/30 p-6 md:p-8">
        <div className="absolute -top-16 -left-16 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-16 -right-16 h-48 w-48 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold">
              🌟 أهلاً، {student?.first_name || "طالبنا المتميز"}
            </h1>
            <p className="text-sm md:text-base text-muted-foreground mt-1">
              {student?.grade ? GRADE_LABEL[student.grade] : "نظرة سريعة على حسابك"}
              {student?.track === "azhar" && " · أزهري"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-3 py-1.5 rounded-full bg-primary/10 text-primary font-mono">
              {student?.student_code}
            </span>
            {student?.banned && (
              <span className="px-3 py-1.5 rounded-full bg-destructive/15 text-destructive font-bold">
                🚫 حساب موقوف
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Stat icon="💰" label="الرصيد" value={`${student?.wallet_balance ?? 0} ج`} />
        <Stat icon="⭐" label="النقاط" value={student?.points ?? 0} />
        <Stat icon="📚" label="كورسات نشطة" value={d?.active_courses.length ?? 0} />
        <Stat icon="🛎️" label="إشعارات جديدة" value={d?.unread_notifications ?? 0} highlight={(d?.unread_notifications ?? 0) > 0} />
      </section>

      {/* Cards grid */}
      <section>
        <h2 className="font-bold text-lg mb-4">الأقسام</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {CARDS.map((c, i) => {
            const badge = c.badge?.(d) ?? null;
            return (
              <Link
                key={c.to}
                to={c.to as any}
                className={`group relative overflow-hidden rounded-2xl p-5 text-white bg-gradient-to-br ${c.gradient} ring-1 ${c.ring} hover:scale-[1.03] hover:shadow-2xl transition-all duration-300`}
                style={{ animation: `fadeIn .4s ease ${i * 60}ms both` }}
              >
                <div className="absolute -top-6 -left-6 h-24 w-24 rounded-full bg-white/15 blur-xl group-hover:bg-white/25 transition" />
                <div className="relative flex items-start justify-between mb-3">
                  <div className="text-3xl">{c.icon}</div>
                  {badge != null && badge !== 0 && (
                    <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-white/25 backdrop-blur">
                      {badge}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <div className="font-bold text-base md:text-lg">{c.title}</div>
                  <div className="text-xs md:text-sm text-white/80 mt-1">{c.desc}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Active subscriptions strip */}
      <section className="surface-card p-5 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-lg">اشتراكاتك النشطة</h2>
          <Link to="/student/courses" className="text-sm text-primary hover:underline">
            عرض الكل ←
          </Link>
        </div>
        {q.isLoading ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-secondary/40 animate-pulse" />
            ))}
          </div>
        ) : !d?.active_courses.length ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            لا توجد اشتراكات نشطة.{" "}
            <Link to="/student/wallet" className="text-primary hover:underline">
              فعّل كوداً
            </Link>{" "}
            لبدء كورس جديد.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {d.active_courses.slice(0, 4).map((c) => (
              <Link
                key={c.course_id}
                to="/student/courses/$id"
                params={{ id: c.course_id }}
                className="block rounded-xl border border-border bg-secondary/30 hover:bg-secondary/60 p-4 transition"
              >
                <div className="font-semibold">{c.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  ينتهي: {new Date(c.expires_at).toLocaleDateString("ar-EG")}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
}

function Stat({ icon, label, value, highlight }: { icon: string; label: string; value: any; highlight?: boolean }) {
  return (
    <div className={`surface-card p-4 md:p-5 transition ${highlight ? "ring-2 ring-rose-400/60" : ""}`}>
      <div className="text-2xl">{icon}</div>
      <div className="text-xs text-muted-foreground mt-2">{label}</div>
      <div className="text-xl md:text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
