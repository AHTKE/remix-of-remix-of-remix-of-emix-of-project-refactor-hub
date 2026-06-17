import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AMW · LMS — منصة الكورسات" },
      { name: "description", content: "منصة كورسات متكاملة تعمل عبر تيليجرام: تصفّح، فعّل كود، وادرس مباشرة." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
      <div className="absolute inset-0 -z-10 brand-gradient opacity-20 blur-3xl" />
      <div className="max-w-3xl text-center space-y-8 py-20">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-secondary/60 backdrop-blur border border-border text-sm font-medium">
          ✨ منصة تعليمية متكاملة
        </div>
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight leading-tight">
          <span className="text-gradient">AMW · LMS</span>
          <br />
          منصتك التعليمية الكاملة على تيليجرام
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl mx-auto">
          كورسات، حصص، أكواد تفعيل، امتحانات وتقارير — كل شيء يعمل بدون قاعدة بيانات
          خارجية، ومجاناً عبر قناة تيليجرام الخاصة.
        </p>
        <div className="flex justify-center gap-3 pt-2 flex-wrap">
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-xl brand-gradient text-primary-foreground px-6 py-3 font-semibold glow-ring"
          >
            🎓 دخول الطالب / المعلم
          </Link>
          <Link
            to="/courses"
            className="inline-flex items-center justify-center rounded-xl border border-border bg-secondary/60 backdrop-blur px-6 py-3 font-medium hover:bg-secondary transition"
          >
            📚 تصفّح الكورسات
          </Link>
        </div>
      </div>
    </div>
  );
}
