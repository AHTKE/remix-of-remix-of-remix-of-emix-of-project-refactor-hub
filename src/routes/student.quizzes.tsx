import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listMyQuizzes } from "@/lib/student.functions";

export const Route = createFileRoute("/student/quizzes")({
  component: QuizzesPage,
});

function QuizzesPage() {
  const q = useQuery({ queryKey: ["my-quizzes"], queryFn: () => listMyQuizzes() });

  return (
    <div className="max-w-4xl mx-auto px-5 md:px-8 py-6 md:py-10 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold">🧪 الامتحانات</h1>
        <p className="text-sm text-muted-foreground mt-1">امتحانات متاحة لكورساتك المفعّلة</p>
      </header>

      {q.isLoading ? (
        <div className="surface-card h-40 animate-pulse" />
      ) : !q.data?.length ? (
        <div className="surface-card p-12 text-center text-muted-foreground">لا توجد امتحانات حاليًا.</div>
      ) : (
        <div className="space-y-3">
          {q.data.map((z) => (
            <Link
              key={z.id}
              to="/student/quizzes/$id"
              params={{ id: z.id }}
              className="surface-card p-5 flex items-center justify-between hover:border-primary/40 transition"
            >
              <div className="min-w-0">
                <h3 className="font-bold truncate">{z.title}</h3>
                <div className="text-xs text-muted-foreground mt-1">
                  {z.course_title} • {z.question_count} سؤال • ⏱️ {Math.round(z.duration_seconds / 60)} د
                </div>
              </div>
              <div className="text-left">
                {z.best_score != null ? (
                  <div className="text-sm font-bold text-primary">{z.best_score}/{z.total}</div>
                ) : (
                  <div className="text-xs text-muted-foreground">لم تُمتحن</div>
                )}
                {z.attempts > 0 && <div className="text-[10px] text-muted-foreground">{z.attempts} محاولة</div>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
