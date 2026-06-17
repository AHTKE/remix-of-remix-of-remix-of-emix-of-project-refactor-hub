import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getStats, listCourses, seedDemoData, verifyEndToEndFlow } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/")({
  component: Overview,
});

function SeedButton() {
  const seed = useServerFn(seedDemoData);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="surface-card p-5 border-warning/40">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="font-semibold">🌱 إنشاء بيانات تجريبية</div>
          <div className="text-xs text-muted-foreground mt-1">
            ينشئ كورس + حصة + امتحان + كود تفعيل (DEMO-1234-5678) لتجربة النظام فوراً.
          </div>
        </div>
        <button
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              const r = await seed();
              setMsg("✅ " + r.message);
            } catch (e: any) {
              setMsg("❌ " + e.message);
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          className="rounded-xl bg-warning/20 text-warning border border-warning/40 px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? "..." : "إنشاء"}
        </button>
      </div>
      {msg && <div className="mt-3 text-sm">{msg}</div>}
    </div>
  );
}

function VerifyFlowButton() {
  const verify = useServerFn(verifyEndToEndFlow);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Array<{ key: string; label: string; ok: boolean; detail: string }> | null>(null);
  return (
    <div className="surface-card p-5 border-primary/30">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="font-semibold">🧪 فحص دورة الاشتراك والحصة</div>
          <div className="text-xs text-muted-foreground mt-1">يفحص فتح الكورس، ظهور الحصص، تفاصيل الحصة، الواجب، الامتحان، وإشعارات البوت للطالب والأدمن.</div>
        </div>
        <button onClick={async () => { setBusy(true); try { const r = await verify(); setChecks(r.checks); } finally { setBusy(false); } }} disabled={busy} className="rounded-xl bg-primary/15 text-primary border border-primary/30 px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {busy ? "..." : "تشغيل الفحص"}
        </button>
      </div>
      {checks && <div className="mt-3 grid md:grid-cols-2 gap-2 text-xs">{checks.map((c) => <div key={c.key} className={c.ok ? "text-success" : "text-destructive"}>{c.ok ? "✓" : "✗"} {c.label}: <span className="text-muted-foreground">{c.detail}</span></div>)}</div>}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="surface-card p-5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-gradient">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Overview() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: useServerFn(getStats) });
  const courses = useQuery({ queryKey: ["courses"], queryFn: useServerFn(listCourses) });

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">لوحة التحكم</h1>
          <p className="text-sm text-muted-foreground mt-1">
            نظرة شاملة على المنصة — جميع البيانات تُخزَّن داخل قناة تيليجرام الخاصة.
          </p>
        </div>
        <Link
          to="/admin/courses"
          className="rounded-xl brand-gradient text-primary-foreground px-5 py-2.5 font-semibold glow-ring"
        >
          + كورس جديد
        </Link>
      </div>

      <SeedButton />
      <VerifyFlowButton />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="الكورسات" value={stats.data?.courses ?? "—"} />
        <Stat label="الحصص" value={stats.data?.lessons ?? "—"} />
        <Stat
          label="الأكواد"
          value={stats.data ? `${stats.data.vouchers_used}/${stats.data.vouchers_total}` : "—"}
          hint="مستخدم / إجمالي"
        />
        <Stat label="الطلاب" value={stats.data?.students ?? "—"} />
        <Stat label="التصويتات" value={stats.data?.polls ?? "—"} hint={`${stats.data?.votes ?? 0} صوت`} />
        <Stat label="الامتحانات" value={stats.data?.quizzes ?? "—"} hint={`${stats.data?.attempts ?? 0} محاولة`} />
        <Stat label="نسبة النجاح" value={`${stats.data?.pass_rate ?? 0}%`} />
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">آخر الكورسات</h2>
          <Link to="/admin/courses" className="text-sm text-primary hover:underline">
            عرض الكل ←
          </Link>
        </div>
        {courses.isLoading ? (
          <div className="text-muted-foreground text-sm">جاري التحميل...</div>
        ) : courses.error ? (
          <div className="surface-card p-4 text-destructive text-sm">
            {(courses.error as Error).message}
          </div>
        ) : (courses.data?.length ?? 0) === 0 ? (
          <div className="surface-card p-10 text-center">
            <div className="text-4xl mb-3">📚</div>
            <p className="text-muted-foreground">لا توجد كورسات بعد.</p>
            <Link
              to="/admin/courses"
              className="mt-4 inline-block rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
            >
              أنشئ أول كورس
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.data!.slice(0, 6).map((c) => (
              <div key={c.id} className="surface-card overflow-hidden group">
                <div className="aspect-video relative bg-secondary/40">
                  {c.cover_url ? (
                    <img src={c.cover_url} alt={c.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full brand-gradient opacity-80 flex items-center justify-center text-5xl">📖</div>
                  )}
                  {c.is_pinned && (
                    <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full pin-badge">
                      📌 كورس مثبت
                    </span>
                  )}
                </div>
                <div className="p-4">
                  <div className="font-semibold line-clamp-1">{c.title}</div>
                  {c.subtitle && (
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {c.subtitle}
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>📚 {c.lesson_count} حصة</span>
                    <Link
                      to="/admin/courses"
                      className="text-primary hover:underline"
                    >
                      إدارة
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
