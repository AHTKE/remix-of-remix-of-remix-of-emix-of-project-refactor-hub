import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getMyCourses } from "@/lib/student.functions";
import { BackButton } from "@/components/BackButton";
import type { Course, Lesson } from "@/lib/types";

const listPublishedCourses = createServerFn({ method: "GET" }).handler(async () => {
  const { getCollection } = await import("@/lib/repo.server");
  const [courses, lessons] = await Promise.all([
    getCollection<Course>("courses"),
    getCollection<Lesson>("lessons"),
  ]);
  const counts: Record<string, number> = {};
  for (const l of lessons) counts[l.course_id] = (counts[l.course_id] || 0) + 1;
  return courses
    .filter((c) => c.is_published !== false)
    .map((c) => ({
      id: c.id,
      title: c.title,
      subtitle: c.subtitle,
      cover_file_id: c.cover_file_id,
      cover_url: c.cover_url,
      lesson_count: counts[c.id] || 0,
      is_pinned: !!c.is_pinned,
    }))
    .sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0));
});

export const Route = createFileRoute("/student/courses")({
  component: MyCourses,
});

function MyCourses() {
  const mine = useQuery({ queryKey: ["my-courses"], queryFn: () => getMyCourses() });
  const all = useQuery({
    queryKey: ["published-courses"],
    queryFn: () => listPublishedCourses(),
  });

  const loading = mine.isLoading || all.isLoading;
  const mineList = mine.data ?? [];
  const allList = all.data ?? [];
  const mineIds = new Set(mineList.map((c) => c.id));
  const browseList = allList.filter((c) => !mineIds.has(c.id));

  return (
    <div className="max-w-6xl mx-auto px-5 md:px-8 py-6 md:py-10 space-y-8">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <BackButton fallback="/student" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">📚 كورساتي</h1>
            <p className="text-sm text-muted-foreground mt-1">الكورسات المفعّلة على حسابك</p>
          </div>
        </div>
        <Link
          to="/student/wallet"
          className="rounded-xl brand-gradient text-primary-foreground px-4 py-2 text-sm font-semibold"
        >
          🎟️ فعّل كود
        </Link>
      </header>

      {/* Active subscriptions */}
      <section className="space-y-3">
        <h2 className="font-bold text-lg">اشتراكاتك النشطة</h2>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="surface-card aspect-[4/5] animate-pulse" />
            ))}
          </div>
        ) : mine.error ? (
          <div className="surface-card p-6 text-destructive">{(mine.error as Error).message}</div>
        ) : mineList.length === 0 ? (
          <div className="surface-card p-8 text-center">
            <div className="text-5xl mb-3">📭</div>
            <p className="text-muted-foreground mb-4">
              لم تشترك في أي كورس بعد. تصفح الكورسات المتاحة أدناه وفعّل كوداً.
            </p>
            <Link
              to="/student/wallet"
              className="inline-block rounded-xl brand-gradient text-primary-foreground px-5 py-2.5 font-semibold"
            >
              فعّل كود الآن
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {mineList.map((c) => (
              <Link
                key={c.id}
                to="/student/courses/$id"
                params={{ id: c.id }}
                className="surface-card overflow-hidden group flex flex-col hover:border-primary/40 transition"
              >
                <div className="aspect-video relative bg-secondary/40">
                  {(c.cover_file_id || c.cover_url) ? (
                    <img
                      src={c.cover_file_id ? `/api/public/media/${c.cover_file_id}` : c.cover_url!}
                      alt={c.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                    />
                  ) : (
                    <div className="w-full h-full brand-gradient opacity-80 flex items-center justify-center text-5xl">
                      📖
                    </div>
                  )}
                  {!c.active && (
                    <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-destructive text-destructive-foreground">
                      منتهي
                    </span>
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="font-bold">{c.title}</h3>
                  {c.subtitle && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.subtitle}</p>
                  )}
                  <div className="mt-auto pt-3 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">📚 {c.lesson_count} حصة</span>
                    <span className={c.active ? "text-primary" : "text-destructive"}>
                      {c.active
                        ? `حتى ${new Date(c.expires_at).toLocaleDateString("ar-EG")}`
                        : "منتهي"}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Browse available courses */}
      {browseList.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg">🆕 كورسات متاحة</h2>
            <span className="text-xs text-muted-foreground">
              فعّل كوداً من المحفظة لفتح أي كورس
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {browseList.map((c) => (
              <article
                key={c.id}
                className="surface-card overflow-hidden flex flex-col opacity-90 hover:opacity-100 transition"
              >
                <div className="aspect-video relative bg-secondary/40">
                  {(c.cover_file_id || c.cover_url) ? (
                    <img
                      src={c.cover_file_id ? `/api/public/media/${c.cover_file_id}` : c.cover_url!}
                      alt={c.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full brand-gradient opacity-80 flex items-center justify-center text-5xl">
                      📖
                    </div>
                  )}
                  <span className="absolute bottom-2 left-2 text-[10px] font-medium px-2 py-1 rounded-full bg-background/80 backdrop-blur border border-border">
                    🔒 يتطلب كود
                  </span>
                  {c.is_pinned && (
                    <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full pin-badge">
                      📌 مثبت
                    </span>
                  )}
                </div>
                <div className="p-4 flex-1 flex flex-col">
                  <h3 className="font-bold">{c.title}</h3>
                  {c.subtitle && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{c.subtitle}</p>
                  )}
                  <div className="mt-auto pt-3 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">📚 {c.lesson_count} حصة</span>
                    <Link to="/student/wallet" className="text-primary font-semibold hover:underline">
                      فعّل ←
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
