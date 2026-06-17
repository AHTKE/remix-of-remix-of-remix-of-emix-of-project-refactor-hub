import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getTeacherAnalytics } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/analytics")({
  component: AnalyticsPage,
});

function Stat({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent?: boolean }) {
  return (
    <div className="surface-card p-5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${accent ? "text-gradient" : ""}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function AnalyticsPage() {
  const fn = useServerFn(getTeacherAnalytics);
  const q = useQuery({ queryKey: ["teacher-analytics"], queryFn: fn });

  if (q.isLoading) return <div className="text-muted-foreground">جاري التحميل...</div>;
  if (q.error) return <div className="surface-card p-4 text-destructive">{(q.error as Error).message}</div>;
  const d = q.data!;

  const maxBar = Math.max(1, ...d.timeline.map((b) => b.attempts + b.submissions + b.new_students));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">تحليلات المعلم</h1>
        <p className="text-sm text-muted-foreground mt-1">
          نظرة عميقة على أداء الطلاب والكورسات والتفاعل خلال الفترة الأخيرة.
        </p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="إجمالي الطلاب" value={d.totals.students} hint={`+${d.totals.new_students_7d} هذا الأسبوع`} accent />
        <Stat label="اشتراكات نشطة" value={d.totals.active_subscriptions} />
        <Stat label="محاولات (٧ أيام)" value={d.totals.attempts_7d} />
        <Stat label="تسليمات (٧ أيام)" value={d.totals.submissions_7d} />
        <Stat label="إيراد (٧ أيام)" value={`${d.totals.revenue_7d} ج`} hint="شحن محفظة معتمد" />
        <Stat label="كورسات" value={d.totals.courses} hint={`${d.totals.lessons} حصة`} />
        <Stat label="بانتظار التصحيح" value={d.totals.ungraded_submissions} hint="واجبات لم تصحَّح" />
      </div>

      {/* Timeline */}
      <section className="surface-card p-5">
        <h2 className="text-lg font-semibold mb-4">النشاط — آخر ١٤ يوم</h2>
        <div className="flex items-end gap-1 h-40">
          {d.timeline.map((b) => {
            const total = b.attempts + b.submissions + b.new_students;
            const h = (total / maxBar) * 100;
            return (
              <div key={b.day} className="flex-1 flex flex-col items-center gap-1" title={`${b.day}\nمحاولات: ${b.attempts}\nتسليمات: ${b.submissions}\nطلاب جدد: ${b.new_students}`}>
                <div className="w-full flex flex-col justify-end h-32">
                  <div
                    className="w-full brand-gradient rounded-t-sm transition-all hover:opacity-80"
                    style={{ height: `${Math.max(h, 2)}%` }}
                  />
                </div>
                <div className="text-[9px] text-muted-foreground rotate-45 origin-left whitespace-nowrap">
                  {b.day.slice(5)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 text-xs text-muted-foreground flex gap-4">
          <span>الإجمالي اليومي = محاولات + تسليمات + طلاب جدد</span>
        </div>
      </section>

      {/* Courses table */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">أداء الكورسات</h2>
        <div className="surface-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="text-start p-3">الكورس</th>
                <th className="text-center p-3">حصص</th>
                <th className="text-center p-3">طلاب نشطون</th>
                <th className="text-center p-3">إجمالي اشتراكات</th>
                <th className="text-center p-3">امتحانات</th>
                <th className="text-center p-3">محاولات</th>
                <th className="text-center p-3">متوسط الدرجة</th>
                <th className="text-center p-3">واجبات</th>
                <th className="text-center p-3">تسليمات</th>
              </tr>
            </thead>
            <tbody>
              {d.courses.length === 0 ? (
                <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">لا توجد كورسات بعد</td></tr>
              ) : d.courses.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="p-3 font-medium">{c.title}</td>
                  <td className="p-3 text-center tabular-nums">{c.lessons}</td>
                  <td className="p-3 text-center tabular-nums font-semibold text-primary">{c.active_students}</td>
                  <td className="p-3 text-center tabular-nums">{c.total_subscriptions}</td>
                  <td className="p-3 text-center tabular-nums">{c.quizzes}</td>
                  <td className="p-3 text-center tabular-nums">{c.attempts}</td>
                  <td className="p-3 text-center tabular-nums">
                    <span className={c.avg_score_pct >= 70 ? "text-green-400" : c.avg_score_pct >= 50 ? "text-yellow-400" : "text-destructive"}>
                      {c.avg_score_pct}%
                    </span>
                  </td>
                  <td className="p-3 text-center tabular-nums">{c.homework}</td>
                  <td className="p-3 text-center tabular-nums">{c.submissions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Lessons performance grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <LessonList title="أفضل ٥ حصص أداءً" rows={d.topLessons} color="green" />
        <LessonList title="أضعف ٥ حصص أداءً" rows={d.worstLessons} color="red" />
      </div>

      {/* Students panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="surface-card p-5">
          <h2 className="text-lg font-semibold mb-4">أكثر الطلاب نشاطًا</h2>
          {d.topStudents.length === 0 ? (
            <div className="text-sm text-muted-foreground">لا يوجد نشاط بعد</div>
          ) : (
            <ul className="space-y-2">
              {d.topStudents.map((s, i) => (
                <li key={s.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-secondary/40">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs w-6 h-6 inline-flex items-center justify-center rounded-full bg-primary/20 text-primary font-semibold">
                      {i + 1}
                    </span>
                    <span className="truncate">{s.name}</span>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {s.attempts} اختبار · {s.submissions} واجب · {s.spent} ج
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface-card p-5">
          <h2 className="text-lg font-semibold mb-4">طلاب لم يسلّموا واجبات</h2>
          {d.pendingStudents.length === 0 ? (
            <div className="text-sm text-muted-foreground">كل الطلاب سلّموا واجباتهم 🎉</div>
          ) : (
            <ul className="space-y-2">
              {d.pendingStudents.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-secondary/40">
                  <span className="truncate">{s.name}</span>
                  <span className="text-xs font-semibold text-destructive whitespace-nowrap">
                    {s.pending} متأخر
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function LessonList({
  title,
  rows,
  color,
}: {
  title: string;
  rows: Array<{ lesson_id: string; lesson_title: string; course_title: string; attempts: number; avg_score_pct: number; pass_rate: number }>;
  color: "green" | "red";
}) {
  const tone = color === "green" ? "text-green-400" : "text-destructive";
  return (
    <section className="surface-card p-5">
      <h2 className="text-lg font-semibold mb-4">{title}</h2>
      {rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">لا توجد بيانات كافية بعد</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((l) => (
            <li key={l.lesson_id} className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{l.lesson_title}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{l.course_title}</div>
                </div>
                <div className={`text-sm font-bold tabular-nums ${tone}`}>{l.avg_score_pct}%</div>
              </div>
              <div className="h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                <div
                  className={color === "green" ? "h-full bg-green-400" : "h-full bg-destructive"}
                  style={{ width: `${l.avg_score_pct}%` }}
                />
              </div>
              <div className="text-[11px] text-muted-foreground flex justify-between">
                <span>{l.attempts} محاولة</span>
                <span>نسبة النجاح: {l.pass_rate}%</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}