import { createFileRoute, Link } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AMW · LMS — منصة الكورسات" },
      { name: "description", content: "منصة كورسات متكاملة — اختر بوابتك: طالب، دعم فني، أو مدرس." },
    ],
  }),
  component: Landing,
});

type Portal = {
  to: string;
  search?: Record<string, string>;
  emoji: string;
  title: string;
  desc: string;
  gradient: string;
  ring: string;
};

const PORTALS: Portal[] = [
  {
    to: "/login",
    search: { tab: "login" },
    emoji: "👨‍🎓",
    title: "طالب",
    desc: "تسجيل / إنشاء حساب طالب ومتابعة الحصص والامتحانات",
    gradient: "from-blue-500 via-indigo-500 to-violet-600",
    ring: "ring-indigo-300/40",
  },
  {
    to: "/login",
    search: { tab: "support" },
    emoji: "🧑‍🔧",
    title: "دعم فني",
    desc: "دخول فريق الدعم لمتابعة الطلبات والشحن والرسائل",
    gradient: "from-emerald-500 via-teal-500 to-cyan-600",
    ring: "ring-emerald-300/40",
  },
  {
    to: "/auth",
    emoji: "👨‍🏫",
    title: "مدرس",
    desc: "لوحة تحكم المعلم لرفع الحصص وإدارة المنصة",
    gradient: "from-amber-500 via-orange-500 to-rose-600",
    ring: "ring-amber-300/40",
  },
];

function Landing() {
  return (
    <div dir="rtl" className="min-h-screen relative overflow-hidden">
      {/* Decorative background layers */}
      <div className="absolute inset-0 -z-10 brand-gradient opacity-[0.12] blur-3xl pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-[420px] w-[120%] -z-10 bg-[radial-gradient(ellipse_at_center,_var(--color-primary)/25,_transparent_60%)] pointer-events-none" />

      <header className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 py-5 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl brand-gradient text-primary-foreground">
            A
          </span>
          <span className="text-gradient text-lg">AMW · LMS</span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 pt-6 sm:pt-12 pb-16">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-secondary/60 backdrop-blur border border-border text-xs sm:text-sm font-medium">
            ✨ منصة AMW التعليمية
          </div>
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-tight">
            <span className="text-gradient">اختر بوابة الدخول</span>
          </h1>
          <p className="text-sm sm:text-lg text-muted-foreground leading-relaxed">
            كل بوابة مخصّصة لاحتياجك. اضغط على البطاقة المناسبة لمتابعة عملك.
          </p>
        </div>

        <section className="mt-10 sm:mt-14 grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6">
          {PORTALS.map((p, i) => (
            <Link
              key={p.title}
              to={p.to}
              search={p.search as any}
              className={`group relative overflow-hidden rounded-3xl p-6 sm:p-8 text-white bg-gradient-to-br ${p.gradient} ring-1 ${p.ring} hover:scale-[1.03] hover:shadow-2xl transition-all duration-300 min-h-[220px] flex flex-col`}
              style={{ animation: `portalIn .5s ease ${i * 90}ms both` }}
            >
              <div className="absolute -top-10 -left-10 h-40 w-40 rounded-full bg-white/15 blur-2xl group-hover:bg-white/25 transition" />
              <div className="absolute -bottom-12 -right-12 h-40 w-40 rounded-full bg-black/15 blur-2xl" />

              <div className="relative flex-1 flex flex-col">
                <div className="text-6xl sm:text-7xl drop-shadow-md">{p.emoji}</div>
                <h2 className="mt-4 text-2xl sm:text-3xl font-extrabold">{p.title}</h2>
                <p className="mt-2 text-sm sm:text-base text-white/85 leading-relaxed">{p.desc}</p>
              </div>

              <div className="relative mt-6 inline-flex items-center justify-between rounded-2xl bg-white/15 backdrop-blur px-4 py-3 text-sm font-semibold group-hover:bg-white/25 transition">
                <span>دخول</span>
                <span className="text-lg">←</span>
              </div>
            </Link>
          ))}
        </section>

        <div className="mt-10 text-center text-xs sm:text-sm text-muted-foreground">
          محتاج تتصفح الكورسات قبل التسجيل؟{" "}
          <Link to="/courses" className="text-primary hover:underline font-medium">
            تصفح الكورسات
          </Link>
        </div>
      </main>

      <style>{`
        @keyframes portalIn {
          from { opacity: 0; transform: translateY(16px) scale(0.97); }
          to { opacity: 1; transform: none; }
        }
      `}</style>
    </div>
  );
}
