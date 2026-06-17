import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getMyCourses } from "@/lib/student.functions";

export const Route = createFileRoute("/student/courses")({
  component: MyCourses,
});

function MyCourses() {
  const q = useQuery({ queryKey: ["my-courses"], queryFn: () => getMyCourses() });

  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 py-6 md:py-10 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">📚 كورساتي</h1>
          <p className="text-sm text-muted-foreground mt-1">الكورسات المفعّلة على حسابك</p>
        </div>
        <Link to="/student/wallet" className="rounded-xl brand-gradient text-primary-foreground px-4 py-2 text-sm font-semibold">
          🎟️ فعّل كود
        </Link>
      </header>

      {q.isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (<div key={i} className="surface-card aspect-[4/5] animate-pulse" />))}
        </div>
      ) : q.error ? (
        <div className="surface-card p-6 text-destructive">{(q.error as Error).message}</div>
      ) : !q.data?.length ? (
        <div className="surface-card p-12 text-center">
          <div className="text-5xl mb-3">📭</div>
          <p className="text-muted-foreground mb-4">لم تشترك في أي كورس بعد.</p>
          <Link to="/student/wallet" className="inline-block rounded-xl brand-gradient text-primary-foreground px-5 py-2.5 font-semibold">
            فعّل كود الآن
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {q.data.map((c) => (
            <Link
              key={c.id}
              to="/student/courses/$id"
              params={{ id: c.id }}
              className="surface-card overflow-hidden group flex flex-col hover:border-primary/40 transition"
            >
              <div className="aspect-video relative bg-secondary/40">
                {(c.cover_file_id || c.cover_url) ? (
                  <img
                    src={c.cover_file_id ? `/api/public/media/${c.cover_file_id}` : c.cover_url}
                    alt={c.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                  />
                ) : (
                  <div className="w-full h-full brand-gradient opacity-80 flex items-center justify-center text-5xl">📖</div>
                )}
                {!c.active && (
                  <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-destructive text-destructive-foreground">منتهي</span>
                )}
              </div>
              <div className="p-4 flex-1 flex flex-col">
                <h3 className="font-bold">{c.title}</h3>
                {c.subtitle && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.subtitle}</p>}
                <div className="mt-auto pt-3 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">📚 {c.lesson_count} حصة</span>
                  <span className={c.active ? "text-primary" : "text-destructive"}>
                    {c.active ? `حتى ${new Date(c.expires_at).toLocaleDateString("ar-EG")}` : "منتهي"}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
