import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import type { Course, Lesson } from "@/lib/types";

const listPublicCourses = createServerFn({ method: "GET" }).handler(async () => {
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
      cover_url: c.cover_url,
      cover_file_id: c.cover_file_id,
      is_pinned: c.is_pinned,
      lesson_count: counts[c.id] || 0,
    }))
    .sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0));
});

export const Route = createFileRoute("/courses")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "الكورسات — AMW LMS" },
      { name: "description", content: "تصفح كورسات المنصة وفعّل اشتراكك مباشرة من البوت." },
    ],
  }),
  component: CoursesBrowser,
});

function CoursesBrowser() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["public-courses"],
    queryFn: () => listPublicCourses(),
  });

  return (
    <div dir="rtl" className="min-h-screen">
      <header className="sticky top-0 z-20 backdrop-blur-xl bg-background/70 border-b border-border">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-bold">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg brand-gradient text-primary-foreground">A</span>
            <span className="text-gradient">AMW · LMS</span>
          </Link>
          <a
            href="https://t.me/"
            className="rounded-xl brand-gradient text-primary-foreground px-4 py-2 text-sm font-semibold glow-ring"
          >
            افتح البوت
          </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-4xl font-bold">📚 الكورسات</h1>
          <p className="text-muted-foreground mt-2">
            استعرض الكورسات المتاحة. لفتح المحتوى أرسل كود التفعيل داخل البوت.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="surface-card aspect-[4/5] animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="surface-card p-6 text-destructive">{(error as Error).message}</div>
        ) : !data?.length ? (
          <div className="surface-card p-16 text-center">
            <div className="text-6xl mb-4">📖</div>
            <p className="text-muted-foreground">لا توجد كورسات منشورة حاليًا.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {data.map((c) => (
              <article key={c.id} className="surface-card overflow-hidden group flex flex-col">
                <div className="aspect-video relative bg-secondary/40">
                  {(c.cover_file_id || c.cover_url) ? (
                    <img
                      src={c.cover_file_id ? `/api/public/media/${c.cover_file_id}` : c.cover_url!}
                      alt={c.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                    />
                  ) : (
                    <div className="w-full h-full brand-gradient opacity-80 flex items-center justify-center text-6xl">📖</div>
                  )}
                  {c.is_pinned && (
                    <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full pin-badge">
                      📌 كورس مثبت
                    </span>
                  )}
                  <span className="absolute bottom-3 left-3 text-[11px] font-medium px-2 py-1 rounded-full bg-background/80 backdrop-blur border border-border">
                    🔒 يتطلب كود
                  </span>
                </div>
                <div className="p-5 flex-1 flex flex-col">
                  <h3 className="font-bold text-lg">{c.title}</h3>
                  {c.subtitle && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{c.subtitle}</p>
                  )}
                  <div className="mt-auto pt-4 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">📚 {c.lesson_count} حصة</span>
                    <a
                      href="https://t.me/"
                      className="text-primary font-semibold hover:underline"
                    >
                      فعّل عبر البوت ←
                    </a>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}