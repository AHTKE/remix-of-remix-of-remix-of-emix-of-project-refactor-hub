import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getLesson } from "@/lib/student.functions";

export const Route = createFileRoute("/student/lessons/$id")({
  component: LessonView,
});

function LessonView() {
  const { id } = Route.useParams();
  const q = useQuery({ queryKey: ["lesson", id], queryFn: () => getLesson({ data: { lessonId: id } }) });

  return (
    <div className="max-w-4xl mx-auto px-5 md:px-8 py-6 md:py-10 space-y-5">
      {q.data && (
        <Link to="/student/courses/$id" params={{ id: q.data.course_id }} className="text-sm text-primary hover:underline">
          → رجوع للحصص
        </Link>
      )}

      {q.isLoading ? (
        <div className="surface-card h-64 animate-pulse" />
      ) : q.error ? (
        <div className="surface-card p-6 text-destructive">{(q.error as Error).message}</div>
      ) : q.data && (
        <>
          <header>
            <h1 className="text-2xl md:text-3xl font-bold">{q.data.title}</h1>
            {q.data.description && <p className="text-muted-foreground mt-2">{q.data.description}</p>}
          </header>

          {!q.data.resources?.length ? (
            <div className="surface-card p-8 text-center text-muted-foreground">لا توجد ملفات.</div>
          ) : (
            <div className="space-y-4">
              {q.data.resources.map((r) => (
                <article key={r.id} className="surface-card p-4 md:p-5">
                  <div className="flex items-center gap-2 text-sm font-semibold mb-3">
                    <span>{iconFor(r.kind)}</span>
                    <span>{r.file_name || r.kind}</span>
                  </div>
                  {r.kind === "link" ? (
                    <div className="space-y-3">
                      {googleDrivePreview(r.url) ? (
                        <iframe
                          src={googleDrivePreview(r.url)!}
                          title={r.file_name || "شرح Google Drive"}
                          allow="autoplay; fullscreen"
                          allowFullScreen
                          className="w-full rounded-xl bg-secondary aspect-video border border-border"
                        />
                      ) : null}
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl brand-gradient text-primary-foreground px-4 py-2 text-sm font-semibold"
                      >
                        🔗 فتح الشرح
                      </a>
                    </div>
                  ) : r.kind === "video" ? (
                    r.url && !r.file_id ? (
                      googleDrivePreview(r.url) ? (
                        <iframe
                          src={googleDrivePreview(r.url)!}
                          title={r.file_name || "فيديو الحصة"}
                          allow="autoplay; fullscreen"
                          allowFullScreen
                          className="w-full rounded-xl bg-black aspect-video border border-border"
                          onContextMenu={(e) => e.preventDefault()}
                        />
                      ) : (
                        <SecureVideo src={r.url} title={r.file_name || "فيديو الحصة"} />
                      )
                    ) : (
                      r.file_id ? (
                        <SecureVideo src={`/api/public/media/${encodeURIComponent(r.file_id)}`} title={r.file_name || "فيديو الحصة"} />
                      ) : (
                        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                          ملف الفيديو غير مضبوط. أعد لصق Telegram file_id من لوحة التحكم.
                        </div>
                      )
                    )
                  ) : r.kind === "photo" ? (
                    <img src={`/api/public/media/${r.file_id}`} alt={r.file_name || ""} className="w-full rounded-xl" />
                  ) : r.kind === "audio" ? (
                    <audio src={`/api/public/media/${r.file_id}`} controls className="w-full" />
                  ) : (
                    <a
                      href={`/api/public/media/${r.file_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-xl brand-gradient text-primary-foreground px-4 py-2 text-sm font-semibold"
                    >
                      📥 تحميل / فتح
                    </a>
                  )}
                  {r.caption && <p className="text-sm text-muted-foreground mt-3">{r.caption}</p>}
                </article>
              ))}
            </div>
          )}

          <section className="grid gap-4 md:grid-cols-2">
            {q.data.quiz_id && (
              <Link
                to="/student/quizzes/$id"
                params={{ id: q.data.quiz_id }}
                className="surface-card p-5 hover:border-primary/40 transition text-center"
              >
                🧪 <span className="font-bold">امتحان الحصة</span>{q.data.quiz_title ? ` — ${q.data.quiz_title}` : ""} ←
              </Link>
            )}
            {(q.data.homework || []).map((h) => (
              <Link key={h.id} to="/student/homework" className="surface-card p-5 hover:border-primary/40 transition">
                <div className="font-bold">📝 {h.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {h.last_submission?.graded_at
                    ? `تم التصحيح: ${h.last_submission.score}/${h.max_score}`
                    : h.last_submission
                    ? "تم التسليم — بانتظار التصحيح"
                    : "لم يتم التسليم بعد"}
                </div>
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function iconFor(kind: string) {
  return kind === "video" ? "🎬" : kind === "photo" ? "🖼️" : kind === "audio" ? "🎵" : kind === "link" ? "🔗" : "📄";
}

function googleDrivePreview(url?: string) {
  if (!url) return "";
  const match = url.match(/drive\.google\.com\/file\/d\/([^/]+)/) || url.match(/[?&]id=([^&]+)/);
  return match ? `https://drive.google.com/file/d/${match[1]}/preview` : "";
}
