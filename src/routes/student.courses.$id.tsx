import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getCourseLessons } from "@/lib/student.functions";

export const Route = createFileRoute("/student/courses/$id")({
  component: CourseDetail,
});

function CourseDetail() {
  const { id } = Route.useParams();
  const q = useQuery({
    queryKey: ["course-lessons", id],
    queryFn: () => getCourseLessons({ data: { courseId: id } }),
  });

  return (
    <div className="max-w-4xl mx-auto px-5 md:px-8 py-6 md:py-10 space-y-6">
      <Link to="/student/courses" className="text-sm text-primary hover:underline">→ رجوع لكورساتي</Link>

      {q.isLoading ? (
        <div className="surface-card h-40 animate-pulse" />
      ) : q.error ? (
        <div className="surface-card p-6 text-destructive">{(q.error as Error).message}</div>
      ) : q.data && (
        <>
          <header className="surface-card p-5 md:p-6">
            <h1 className="text-2xl md:text-3xl font-bold">{q.data.course.title}</h1>
            {q.data.course.subtitle && <p className="text-muted-foreground mt-2">{q.data.course.subtitle}</p>}
            <div className="mt-3 text-xs text-muted-foreground">
              صالح حتى: <span className="text-primary font-semibold">{new Date(q.data.expires_at).toLocaleDateString("ar-EG")}</span>
            </div>
          </header>

          <section className="space-y-2">
            <h2 className="font-bold text-lg px-1">📖 الحصص ({q.data.lessons.length})</h2>
            {!q.data.lessons.length ? (
              <div className="surface-card p-8 text-center text-muted-foreground">لم تُضف حصص بعد.</div>
            ) : (
              q.data.lessons.map((l, i) => (
                <Link
                  key={l.id}
                  to="/student/lessons/$id"
                  params={{ id: l.id }}
                  className="surface-card p-4 flex items-center gap-4 hover:border-primary/40 transition"
                >
                  <div className="h-10 w-10 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center text-sm">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{l.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      🎬 {l.resource_count} ملف {l.has_quiz && "• 🧪 امتحان"} {l.homework_count ? `• 📝 ${l.homework_count} واجب` : ""}
                    </div>
                  </div>
                  <span className="text-muted-foreground">←</span>
                </Link>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
